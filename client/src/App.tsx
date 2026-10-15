import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'

type User = { id:string; name:string; email:string; role:'admin'|'agent'|'requester'; workspaceName:string }
type Ticket = { id:string; subject:string; description:string; category:string; priority:string; status:string; due_at:string|null; created_at:string; updated_at:string; requester_id:string; requester_name:string; requester_email:string; assignee_id:string|null; assignee_name:string|null }
type Comment = { id:string; body:string; created_at:string; author_id:string; author_name:string; author_role:string }
type Activity = { id:string; action:string; details:string; created_at:string; actor_name:string }
type Detail = Ticket & { comments:Comment[]; activity:Activity[] }
type Member = { id:string; name:string; email:string; role:string }
type Metrics = { total:number; open:number; in_progress:number; waiting:number; resolved:number; urgent:number; overdue:number }

async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const response = await fetch(`/api${path}`, { credentials:'same-origin', ...init, headers:{ ...(init.body ? {'Content-Type':'application/json'} : {}), ...init.headers } })
  if (response.status === 204) return undefined as T
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data as T
}
const initials=(name:string)=>name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()
const dateLabel=(value:string)=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(new Date(value))
const dateTime=(value:string)=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))
const roleName=(role:string)=>role==='admin'?'Admin':role==='agent'?'Support agent':'Requester'
const categories=['Access','Hardware','Software','Network','People','General']

function App(){
  const [user,setUser]=useState<User|null>(null)
  const [booting,setBooting]=useState(true)
  const [tickets,setTickets]=useState<Ticket[]>([])
  const [members,setMembers]=useState<Member[]>([])
  const [metrics,setMetrics]=useState<Metrics>({total:0,open:0,in_progress:0,waiting:0,resolved:0,urgent:0,overdue:0})
  const [query,setQuery]=useState('')
  const [status,setStatus]=useState('all')
  const [scope,setScope]=useState('all')
  const [selected,setSelected]=useState<Detail|null>(null)
  const [showCreate,setShowCreate]=useState(false)
  const [toast,setToast]=useState('')
  const [live,setLive]=useState(false)
  const [loading,setLoading]=useState(false)

  const notify=useCallback((message:string)=>{setToast(message);window.setTimeout(()=>setToast(''),2800)},[])
  const loadData=useCallback(async()=>{
    if(!user)return
    setLoading(true)
    try{
      const params=new URLSearchParams()
      if(status!=='all')params.set('status',status)
      if(query.trim())params.set('q',query.trim())
      if(scope==='urgent')params.set('priority','Urgent')
      const [ticketData,dashboard,memberData]=await Promise.all([
        api<{tickets:Ticket[]}>(`/tickets?${params}`),api<Metrics>('/dashboard'),api<Member[]>('/members')
      ])
      setTickets(ticketData.tickets);setMetrics(dashboard);setMembers(memberData)
      if(selected){try{setSelected(await api<Detail>(`/tickets/${selected.id}`))}catch{setSelected(null)}}
    }catch(error){notify(error instanceof Error?error.message:'Could not load tickets')}
    finally{setLoading(false)}
  },[user,status,query,scope,selected,notify])

  useEffect(()=>{api<{user:User}>('/auth/me').then(data=>setUser(data.user)).catch(()=>setUser(null)).finally(()=>setBooting(false))},[])
  useEffect(()=>{if(user)loadData()},[user,status,query,scope]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!user)return
    const stream=new EventSource('/api/events')
    stream.onopen=()=>setLive(true)
    stream.onerror=()=>setLive(false)
    stream.addEventListener('tickets.changed',()=>loadData())
    return()=>stream.close()
  },[user,loadData])

  async function signIn(email:string,password:string){
    try{const data=await api<{user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setUser(data.user);notify(`Welcome back, ${data.user.name.split(' ')[0]}`)}
    catch(error){notify(error instanceof Error?error.message:'Unable to sign in')}
  }
  async function registerWorkspace(name:string,workspaceName:string,email:string,password:string){
    try{const data=await api<{user:User}>('/auth/register',{method:'POST',body:JSON.stringify({name,workspaceName,email,password})});setUser(data.user);notify(`Workspace ${data.user.workspaceName} created`)}
    catch(error){notify(error instanceof Error?error.message:'Unable to create workspace')}
  }
  async function signOut(){await api('/auth/logout',{method:'POST'}).catch(()=>{});setUser(null);setTickets([]);setSelected(null);}
  async function createTicket(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget)
    try{
      await api('/tickets',{method:'POST',body:JSON.stringify({subject:form.get('subject'),description:form.get('description'),category:form.get('category'),priority:form.get('priority')})})
      setShowCreate(false);notify('Ticket submitted');loadData()
    }catch(error){notify(error instanceof Error?error.message:'Could not create ticket')}
  }
  async function updateTicket(id:string,patch:Record<string,unknown>){
    try{await api(`/tickets/${id}`,{method:'PATCH',body:JSON.stringify(patch)});notify('Ticket updated');loadData()}
    catch(error){notify(error instanceof Error?error.message:'Could not update ticket')}
  }
  async function openTicket(ticket:Ticket){try{setSelected(await api<Detail>(`/tickets/${ticket.id}`))}catch(error){notify(error instanceof Error?error.message:'Could not open ticket')}}
  async function addComment(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!selected)return
    const formElement=event.currentTarget;const form=new FormData(formElement);const body=String(form.get('body')||'').trim();if(!body)return
    try{await api(`/tickets/${selected.id}/comments`,{method:'POST',body:JSON.stringify({body})});formElement.reset();setSelected(await api<Detail>(`/tickets/${selected.id}`));loadData()}
    catch(error){notify(error instanceof Error?error.message:'Comment could not be added')}
  }

  if(booting)return <div className="boot-screen"><div className="brand-mark">t</div><span>Opening your workspace…</span></div>
  if(!user)return <Login onSubmit={signIn} onRegister={registerWorkspace}/>

  const isStaff=user.role!=='requester'
  const filteredTickets=scope==='mine'?tickets.filter(ticket=>ticket.assignee_id===user.id||ticket.requester_id===user.id):tickets
  const openCount=metrics.open+metrics.in_progress+metrics.waiting
  const greeting=new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date())

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#home"><span className="brand-mark">t</span><span>teamdesk<span className="brand-period">.</span></span></a>
      <div className="workspace-switch"><span className="workspace-symbol">N</span><span><b>{user.workspaceName}</b><small>Team workspace</small></span><span className="workspace-arrow">⌄</span></div>
      <div className="sidebar-label">WORKSPACE</div>
      <button className={`side-link ${scope==='all'?'selected':''}`} onClick={()=>{setScope('all');setStatus('all')}}><span>▤</span> Inbox <b className="side-badge">{openCount}</b></button>
      <button className={`side-link ${scope==='mine'?'selected':''}`} onClick={()=>setScope('mine')}><span>♙</span> My tickets</button>
      <button className={`side-link ${scope==='urgent'?'selected':''}`} onClick={()=>setScope('urgent')}><span>⚑</span> Urgent <b className="side-badge urgent-count">{metrics.urgent}</b></button>
      <div className="sidebar-label section-gap">VIEWS</div>
      <button className={`side-link ${status==='Open'?'selected':''}`} onClick={()=>{setScope('all');setStatus(status==='Open'?'all':'Open')}}><span className="status-dot open-dot"/> Open</button>
      <button className={`side-link ${status==='Resolved'?'selected':''}`} onClick={()=>{setScope('all');setStatus(status==='Resolved'?'all':'Resolved')}}><span className="status-dot resolved-dot"/> Resolved</button>
      <div className="sidebar-bottom"><div className="workspace-health"><span className="health-spark">✦</span><div><b>Workspace is healthy</b><small>All systems operational</small></div><i/></div><button className="profile-button" onClick={signOut}><span className="user-avatar">{initials(user.name)}</span><span className="profile-copy"><b>{user.name}</b><small>{roleName(user.role)}</small></span><span className="profile-menu">···</span></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">{user.workspaceName}<span>/</span><b>Inbox</b></div><div className="topbar-right"><span className={`live-pill ${live?'is-live':''}`}><i/>{live?'Live':'Connecting'}</span><button className="top-icon" aria-label="Search" onClick={()=>document.getElementById('ticket-search')?.focus()}>⌕</button><button className="top-icon notification-icon" aria-label="Notifications">♧<i/></button><span className="user-avatar small-avatar">{initials(user.name)}</span></div></header>
      <div className="content-wrap">
        <section className="welcome-row"><div><div className="date-line">{greeting} <span className="date-dot">·</span> <span className="live-copy">Your support overview</span></div><h1>Good {new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, {user.name.split(' ')[0]} <span className="wave">✦</span></h1><p>Here’s what’s happening across your support desk.</p></div><button className="primary-button" onClick={()=>setShowCreate(true)}><span>＋</span> New ticket</button></section>
        <section className="metric-grid" aria-label="Support metrics">
          <Metric label="Open tickets" value={metrics.open} icon="◷" tone="blue" hint="Needs a first response"/>
          <Metric label="In progress" value={metrics.in_progress} icon="↗" tone="violet" hint="Being worked on"/>
          <Metric label="Urgent" value={metrics.urgent} icon="⚑" tone="orange" hint="Prioritize these"/>
          <Metric label="Resolved" value={metrics.resolved} icon="✓" tone="green" hint="Closed successfully"/>
        </section>
        <section className="tickets-card">
          <div className="card-heading"><div><div className="heading-title">{scope==='mine'?'My tickets':scope==='urgent'?'Urgent tickets':'All tickets'} <span className="number-chip">{filteredTickets.length}</span></div><div className="heading-subtitle">Track requests and keep the team moving.</div></div><div className="heading-controls"><button className="filter-button" onClick={()=>setStatus(status==='all'?'Open':'all')}>☷ <span>{status==='all'?'Filter':'Open only'}</span>⌄</button><button className="view-button" aria-label="List view">☷</button></div></div>
          <div className="ticket-toolbar"><label className="search-field"><span>⌕</span><input id="ticket-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search tickets, people…"/><kbd>⌘ K</kbd></label><div className="toolbar-meta"><span className="refresh-copy">{loading?'Updating…':'Live list'}</span><span className="toolbar-divider"/><select aria-label="Sort tickets" defaultValue="updated"><option value="updated">Recently updated</option><option value="priority">Priority</option></select></div></div>
          <div className="ticket-table-wrap"><table className="ticket-table"><thead><tr><th className="ticket-main-col">TICKET</th><th>REQUESTER</th><th>ASSIGNEE</th><th>PRIORITY</th><th>STATUS</th><th>UPDATED</th></tr></thead><tbody>
            {filteredTickets.map(ticket=><tr key={ticket.id} onClick={()=>openTicket(ticket)} className="ticket-row"><td><div className="subject-cell"><span className={`priority-rail ${ticket.priority.toLowerCase()}`}/><div><b>{ticket.subject}</b><small><span className="ticket-number">#{ticket.id.slice(0,6).toUpperCase()}</span><span>·</span>{ticket.category}</small></div></div></td><td><div className="person-cell"><span className={`mini-avatar avatar-${ticket.requester_name.charCodeAt(0)%5}`}>{initials(ticket.requester_name)}</span><span>{ticket.requester_name}</span></div></td><td>{ticket.assignee_name?<div className="person-cell"><span className={`mini-avatar avatar-${ticket.assignee_name.charCodeAt(0)%5}`}>{initials(ticket.assignee_name)}</span><span>{ticket.assignee_name.split(' ')[0]}</span></div>:<span className="unassigned">Unassigned</span>}</td><td><Priority value={ticket.priority}/></td><td><Status value={ticket.status}/></td><td><span className="updated-date">{dateLabel(ticket.updated_at)}</span></td></tr>)}
            {!filteredTickets.length&&<tr><td colSpan={6}><div className="empty-list"><span>⌕</span><b>No tickets match this view</b><small>Try another filter or create a new ticket.</small><button onClick={()=>setShowCreate(true)}>Create a ticket</button></div></td></tr>}
          </tbody></table></div>
          <footer className="table-bottom"><span>Showing <b>{filteredTickets.length}</b> tickets in this view</span><div className="pagination"><button disabled>‹</button><button className="page-current">1</button><button disabled>›</button><span>Updated live</span></div></footer>
        </section>
        <footer className="page-footer"><span>TeamDesk · Support operations</span><span>{metrics.overdue} overdue <i/></span></footer>
      </div>
    </main>
    {showCreate&&<div className="overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setShowCreate(false)}}><form className="dialog create-dialog" onSubmit={createTicket}><div className="dialog-top"><div><span className="dialog-eyebrow">NEW REQUEST</span><h2>Create a ticket</h2><p>Give your support team the details they need.</p></div><button type="button" className="close-button" onClick={()=>setShowCreate(false)}>×</button></div><label>Subject <em>*</em><input name="subject" required minLength={4} maxLength={160} placeholder="What do you need help with?"/></label><label>Description<textarea name="description" rows={4} placeholder="Add useful details, steps to reproduce, or context…"/></label><div className="form-row"><label>Category<select name="category">{categories.map(item=><option key={item}>{item}</option>)}</select></label><label>Priority<select name="priority" defaultValue="Medium"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label></div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setShowCreate(false)}>Cancel</button><button type="submit" className="primary-button">Submit ticket <span>→</span></button></div></form></div>}
    {selected&&<div className="overlay detail-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setSelected(null)}}><section className="detail-panel"><div className="detail-top"><span className="dialog-eyebrow">TICKET #{selected.id.slice(0,6).toUpperCase()}</span><button className="close-button" onClick={()=>setSelected(null)}>×</button></div><div className="detail-category">{selected.category} <span>·</span> created {dateTime(selected.created_at)}</div><h2>{selected.subject}</h2><p className="detail-description">{selected.description||'No description was added.'}</p><div className="detail-controls">
      <label>Status<select disabled={!isStaff} value={selected.status} onChange={event=>updateTicket(selected.id,{status:event.target.value})}>{['Open','In Progress','Waiting','Resolved','Closed'].map(item=><option key={item}>{item}</option>)}</select></label>
      <label>Priority<select disabled={!isStaff} value={selected.priority} onChange={event=>updateTicket(selected.id,{priority:event.target.value})}>{['Low','Medium','High','Urgent'].map(item=><option key={item}>{item}</option>)}</select></label>
      <label>Assignee<select disabled={!isStaff} value={selected.assignee_id||''} onChange={event=>updateTicket(selected.id,{assigneeId:event.target.value||null})}><option value="">Unassigned</option>{members.filter(member=>member.role!=='requester').map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <div className="requester-box"><span className={`mini-avatar avatar-${selected.requester_name.charCodeAt(0)%5}`}>{initials(selected.requester_name)}</span><div><small>REQUESTER</small><b>{selected.requester_name}</b></div></div>
    </div><div className="conversation-heading"><div><b>Conversation</b><small>{selected.comments.length} replies</small></div><span className="conversation-line"/></div><div className="conversation-list">{selected.comments.map(comment=><article className="comment" key={comment.id}><span className={`mini-avatar avatar-${comment.author_name.charCodeAt(0)%5}`}>{initials(comment.author_name)}</span><div className="comment-body"><div><b>{comment.author_name}</b><span>{dateTime(comment.created_at)}</span></div><p>{comment.body}</p></div></article>)}{!selected.comments.length&&<div className="no-comments">No replies yet. Add the first one below.</div>}</div><div className="activity-heading"><b>Recent activity</b></div><div className="activity-list">{selected.activity.map(item=><div className="activity-item" key={item.id}><i/><span><b>{item.actor_name}</b> {item.details.toLowerCase()}<small>{dateTime(item.created_at)}</small></span></div>)}</div><form className="reply-form" onSubmit={addComment}><textarea name="body" required maxLength={4000} placeholder="Write a reply…"/><div className="reply-actions"><span>Replying as {user.name.split(' ')[0]}</span><button type="submit" className="primary-button">Send reply <span>→</span></button></div></form></section></div>}
    {toast&&<div role="status" className="toast-message">{toast}</div>}
  </div>
}

function Login({onSubmit,onRegister}:{onSubmit:(email:string,password:string)=>void;onRegister:(name:string,workspaceName:string,email:string,password:string)=>void}){
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [name,setName]=useState('');const [workspaceName,setWorkspaceName]=useState('');
  const [email,setEmail]=useState('admin@teamdesk.local');const [password,setPassword]=useState('Teamdesk!2026');
  function submit(event:FormEvent){event.preventDefault();mode==='login'?onSubmit(email,password):onRegister(name,workspaceName,email,password)}
  return <div className="login-page"><div className="login-art"><div className="login-orbit orbit-one"/><div className="login-orbit orbit-two"/><div className="login-glow"/><div className="login-copy"><a className="brand brand-light" href="#login"><span className="brand-mark">t</span><span>teamdesk<span className="brand-period">.</span></span></a><div className="hero-label"><i/> SUPPORT OPERATIONS</div><h1>Make every<br/>request feel<br/><span>handled.</span></h1><p>A calm, clear workspace for teams that care about getting people unstuck.</p><div className="login-quote"><span>“</span><p>The work feels lighter when nothing slips through the cracks.</p><small>— Your future support team</small></div></div><div className="art-caption">A LITTLE MORE CLARITY. A LOT MORE MOMENTUM.</div></div><div className="login-side"><div className="login-mobile-brand"><a className="brand" href="#login"><span className="brand-mark">t</span><span>teamdesk<span className="brand-period">.</span></span></a></div><form className="login-form" onSubmit={submit}><div className="login-icon">↗</div><div className="login-eyebrow">{mode==='login'?'YOUR WORKSPACE':'GET STARTED'}</div><h2>{mode==='login'?'Welcome back':'Create your workspace'}</h2><p>{mode==='login'?'Sign in to pick up where your team left off.':'Set up a support desk for your company.'}</p>{mode==='register'&&<><label>Your name<input value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={80} required autoComplete="name" placeholder="e.g. Jordan Lee"/></label><label>Company or team<input value={workspaceName} onChange={event=>setWorkspaceName(event.target.value)} minLength={2} maxLength={100} required placeholder="e.g. Northstar Studio"/></label></>}<label>Work email<input type="email" value={email} onChange={event=>setEmail(event.target.value)} required autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={event=>setPassword(event.target.value)} minLength={mode==='register'?12:8} required autoComplete={mode==='login'?'current-password':'new-password'}/>{mode==='register'&&<small className="field-help">Use at least 12 characters.</small>}</label><button className="primary-button login-submit" type="submit">{mode==='login'?'Sign in':'Create workspace'} <span>→</span></button>{mode==='login'&&<div className="demo-note"><b>Demo workspace</b><span>Seeded accounts are ready to explore.</span><small>Admin: admin@teamdesk.local<br/>Password: Teamdesk!2026</small></div>}<div className="mode-switch">{mode==='login'?"New to TeamDesk?":"Already have a workspace?"} <button type="button" onClick={()=>{const next=mode==='login'?'register':'login';setMode(next);setName('');setWorkspaceName('');setEmail(next==='login'?'admin@teamdesk.local':'');setPassword(next==='login'?'Teamdesk!2026':'')}}>{mode==='login'?'Create a workspace':'Sign in'}</button></div><div className="login-foot">Protected with workspace-only access <span>·</span> Built for teams</div></form></div></div>
}
function Metric({label,value,icon,tone,hint}:{label:string;value:number;icon:string;tone:string;hint:string}){return <article className="metric-card"><div className="metric-head"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className="metric-hint"><i className={tone}/>{hint}</div><div className={`metric-bars ${tone}`}><i/><i/><i/><i/><i/><i/><i/><i/></div></article>}
function Priority({value}:{value:string}){return <span className={`priority-tag priority-${value.toLowerCase()}`}><i/>{value}</span>}
function Status({value}:{value:string}){return <span className={`status-tag status-${value.toLowerCase().replaceAll(' ','-')}`}><i/>{value}</span>}

export default App

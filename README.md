<div align="center">

# TeamDesk

### Support requests, handled with clarity.

An end-to-end support desk for company IT, access, hardware, software, and people-operations requests. Triage work in one place, keep conversations attached to tickets, and see updates live without refreshing the page.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/API-Express-222222?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20PGlite-4169E1?logo=postgresql&logoColor=white)

</div>

---

## What you can do

- **Track the work:** a live inbox, status and priority views, search, ticket details, and operational metrics.
- **Handle the full request:** create and assign tickets, update their status or priority, and keep replies and activity together.
- **Give each role the right access:** requesters see their own tickets; agents and admins can triage and assign workspace tickets.
- **Stay in sync:** Server-Sent Events update the inbox and open ticket details across sessions without a page reload.
- **Keep data on the backend:** an Express API, PostgreSQL schema, persistent local PGlite database, and workspace-scoped queries.
- **Start exploring immediately:** first run seeds a demo workspace with example tickets and accounts.

## Demo accounts

Use these local demo accounts to explore each role. All three use `Teamdesk!2026`.

| Role | Email | What to explore |
| --- | --- | --- |
| Admin | `admin@teamdesk.local` | Workspace inbox, assignment, status, and priority controls |
| Support agent | `agent@teamdesk.local` | Triage and ticket conversations |
| Requester | `requester@teamdesk.local` | Create a request and follow its progress |

> Demo credentials are for local development only. Change or remove them before deploying an instance for real users.

## Run locally

### Requirements

- Node.js **20.19 or newer**
- npm

### Start the app

```bash
git clone https://github.com/Moulik2886/teamdesk.git
cd teamdesk
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead. Set `JWT_SECRET` in `.env` to a private random value of at least 32 characters. Then start the whole local stack:

```bash
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)**. The frontend runs on port `5173`, the API on `4000`, and the persistent local PostgreSQL-compatible PGlite database on `5432`. Local database files are stored under `server/data/`; they remain on your computer and are excluded from Git.

Press `Ctrl+C` in the terminal to stop the stack. Start it again with `npm run dev`.

## Check the API workflows

With the local stack running in one terminal, run this in another:

```bash
npm run test:api
```

The smoke check covers authentication, workspace registration, role permissions, concurrent dashboard requests, ticket search and CRUD, comments, data isolation, and realtime events. It removes its temporary ticket and workspace records when it finishes.

Build the frontend for production hosting:

```bash
npm run build
```

The optimized static files are written to `client/dist/`.

## How it fits together

```text
React + TypeScript + Vite
          │  /api proxy in development
          ▼
     Express API ───── Server-Sent Events
          │
          ▼
 PostgreSQL-compatible database
  PGlite locally · PostgreSQL in deployment
```

| Area | Technology |
| --- | --- |
| Client | React 19, TypeScript, Vite |
| API | Node.js, Express 5, Zod validation |
| Persistence | PostgreSQL schema, `pg` client, PGlite for local development |
| Authentication | Hashed passwords, signed JWT session in an HttpOnly cookie |
| Live updates | Server-Sent Events (SSE) |

## API at a glance

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API and database health |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/register` | Create a workspace and admin account |
| `POST` | `/api/auth/logout` | End the current session |
| `GET` | `/api/auth/me` | Get the current account |
| `GET` | `/api/dashboard` | Workspace ticket metrics |
| `GET` | `/api/members` | List workspace members |
| `GET` | `/api/tickets` | Search and filter tickets |
| `POST` | `/api/tickets` | Create a ticket |
| `GET` | `/api/tickets/:id` | Ticket, comments, and activity |
| `PATCH` | `/api/tickets/:id` | Update status, priority, assignee, category, or due date |
| `POST` | `/api/tickets/:id/comments` | Add a ticket reply |
| `GET` | `/api/events` | Authenticated live event stream |

The database schema and indexes live in [`server/sql/schema.sql`](server/sql/schema.sql). The API smoke check is in [`server/smoke-check.mjs`](server/smoke-check.mjs).

## Use a PostgreSQL server

`npm run dev` starts the included persistent PGlite database, so a separate PostgreSQL or Docker installation is not required for local work. The repository also includes a PostgreSQL Docker Compose service for teams that want to run a standard PostgreSQL server locally:

```bash
docker compose up -d database
```

For deployment, provide a PostgreSQL `DATABASE_URL` and a strong `JWT_SECRET` through the hosting environment, then run the API with:

```bash
npm start
```

Build and host `client/dist/` as a static site, and configure the web server or reverse proxy to send `/api` requests to the API. Use HTTPS, set `COOKIE_SECURE=true`, and replace demo users with your real account onboarding process before handling company data.

## Project layout

```text
teamdesk/
├── client/                 React application and Vite configuration
├── server/
│   ├── src/                Express API, auth, events, and local bootstrap
│   ├── sql/schema.sql      PostgreSQL tables and indexes
│   └── smoke-check.mjs     Repeatable API workflow check
├── docker-compose.yml      Optional PostgreSQL service
├── .env.example            Environment variable template
└── package.json            Workspace scripts
```

---

Built for teams that want every request to have an owner, a clear status, and a useful next step.

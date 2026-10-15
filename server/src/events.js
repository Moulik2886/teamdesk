const connections = new Set();

export function addConnection(response, workspaceId) {
  const connection = { response, workspaceId };
  connections.add(connection);
  return () => connections.delete(connection);
}
export function publish(workspaceId, event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const connection of connections) {
    if (connection.workspaceId === workspaceId) connection.response.write(message);
  }
}
export function keepAlive() {
  for (const connection of connections) connection.response.write(': keep-alive\n\n');
}

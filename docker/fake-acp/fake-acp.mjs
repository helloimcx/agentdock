import { WebSocket, WebSocketServer } from 'ws';

const port = Number(process.env.AGENTDOCK_ACP_PORT || 8080);
const server = new WebSocketServer({ port });

server.on('connection', (socket) => {
  socket.on('message', (data) => {
    const line = data.toString('utf8').trim();
    if (!line) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    if (payload.method === 'initialize') {
      send(socket, { jsonrpc: '2.0', id: payload.id, result: { agentCapabilities: { loadSession: false } } });
      return;
    }
    if (payload.method === 'session/new') {
      send(socket, { jsonrpc: '2.0', id: payload.id, result: { sessionId: 'compose-e2e-session' } });
      return;
    }
    if (payload.method === 'session/prompt') {
      send(socket, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: payload.params?.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'compose sandbox acp ok' },
          },
        },
      });
      send(socket, { jsonrpc: '2.0', id: payload.id, result: { stopReason: 'end_turn' } });
      return;
    }
    send(socket, { jsonrpc: '2.0', id: payload.id, result: {} });
  });
});

process.stdout.write(`Fake ACP server listening on ${port}\n`);

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(`${JSON.stringify(payload)}\n`);
  }
}

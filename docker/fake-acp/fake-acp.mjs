import process from 'node:process';
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  if (payload.method === 'initialize') {
    send({ jsonrpc: '2.0', id: payload.id, result: { agentCapabilities: { loadSession: false } } });
    return;
  }
  if (payload.method === 'session/new') {
    send({ jsonrpc: '2.0', id: payload.id, result: { sessionId: 'compose-e2e-session' } });
    return;
  }
  if (payload.method === 'session/prompt') {
    send({
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
    send({ jsonrpc: '2.0', id: payload.id, result: { stopReason: 'end_turn' } });
    return;
  }
  send({ jsonrpc: '2.0', id: payload.id, result: {} });
});

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

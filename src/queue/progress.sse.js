const clients = new Map();

function registerSSEClient(kitId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const id = kitId.toString();
  if (!clients.has(id)) {
    clients.set(id, new Set());
  }
  clients.get(id).add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.get(id)?.delete(res);
    if (clients.get(id)?.size === 0) {
      clients.delete(id);
    }
  });
}

function sendProgress(kitId, payload) {
  const id = kitId.toString();
  const set = clients.get(id);
  if (!set) return;

  const data = JSON.stringify(payload);
  for (const res of set) {
    res.write(`data: ${data}\n\n`);
  }
}

module.exports = { registerSSEClient, sendProgress };

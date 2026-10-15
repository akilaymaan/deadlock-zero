import { createServer } from 'node:http';

const configuredPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isNaN(configuredPort) ? 3000 : configuredPort;

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`DeadlockZero server listening on http://localhost:${port}`);
});

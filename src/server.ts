import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server/index';

export * from './server/index';

// Keep the original `tsx src/server.ts` entry point working while the actual
// Express implementation lives under src/server/.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startServer } from './app';

export * from './app';

const isDirectExecution = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) startServer();

export default createApp;

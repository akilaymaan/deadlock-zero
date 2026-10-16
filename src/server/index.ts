import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app';
import { ConfigError, loadConfig } from './config';
import { createLogger, errorFields } from './logger';

export { createApp, startServer } from './app';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Invalid configuration: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  const running = startServer({ config, logger });
  let shuttingDown = false;

  running.server.on('error', (error) => {
    logger.error('server failed to start', errorFields(error));
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    running.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error('error during shutdown', errorFields(error));
        process.exit(1);
      },
    );
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', errorFields(reason));
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', errorFields(error));
    process.exit(1);
  });
}

const isDirectExecution =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) main();

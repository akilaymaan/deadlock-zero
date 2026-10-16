import type { LogLevel } from './config';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * Minimal structured logger writing one JSON object per line. Callers must not pass
 * request bodies or trace contents; only operational metadata belongs in logs.
 */
export function createLogger(level: LogLevel, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const threshold = LEVEL_WEIGHT[level];
  const emit = (entryLevel: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: entryLevel, msg: message, ...fields }));
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  return { errorMessage: String(error) };
}

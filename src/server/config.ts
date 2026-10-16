import { DEFAULT_WORKER_COUNT, SIMULATION_LIMITS } from '../engine/simulator';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
  /** Allowed cross-origin callers. Empty means same-origin only (CORS disabled). */
  readonly corsOrigins: readonly string[];
  readonly trustProxy: boolean;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly maxTraceEvents: number;
  readonly defaultSimulationWorkers: number;
  readonly maxSimulationWorkers: number;
  readonly bodyLimitBytes: number;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function readInteger(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be an integer, received "${raw}"`);
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigError(`${name} must be between ${min} and ${max}, received ${value}`);
  return value;
}

function readBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`${name} must be "true" or "false", received "${raw}"`);
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/** Parse and validate configuration. Invalid values fail fast with an actionable message. */
export function loadConfig(env: Env = process.env): ServerConfig {
  const logLevel = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, received "${env.LOG_LEVEL}"`);
  }
  const corsOrigins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of corsOrigins) {
    if (origin === '*') throw new ConfigError('CORS_ORIGIN="*" is not allowed; list explicit origins');
    try {
      new URL(origin);
    } catch {
      throw new ConfigError(`CORS_ORIGIN contains an invalid origin URL: "${origin}"`);
    }
  }
  const maxSimulationWorkers = readInteger(env, 'MAX_SIMULATION_WORKERS', SIMULATION_LIMITS.maxWorkers, 1, SIMULATION_LIMITS.maxWorkers);
  const defaultSimulationWorkers = readInteger(env, 'SIMULATION_WORKERS', DEFAULT_WORKER_COUNT, 1, SIMULATION_LIMITS.maxWorkers);
  if (defaultSimulationWorkers > maxSimulationWorkers) {
    throw new ConfigError('SIMULATION_WORKERS must not exceed MAX_SIMULATION_WORKERS');
  }
  const host = env.HOST?.trim() || '0.0.0.0';

  return {
    nodeEnv: env.NODE_ENV?.trim() || 'development',
    port: readInteger(env, 'PORT', 3000, 0, 65_535),
    host,
    logLevel,
    corsOrigins,
    trustProxy: readBoolean(env, 'TRUST_PROXY', false),
    rateLimitWindowMs: readInteger(env, 'RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
    rateLimitMax: readInteger(env, 'RATE_LIMIT_MAX', 60, 1, 100_000),
    maxTraceEvents: readInteger(env, 'MAX_TRACE_EVENTS', 10_000, 1, 100_000),
    defaultSimulationWorkers,
    maxSimulationWorkers,
    bodyLimitBytes: readInteger(env, 'BODY_LIMIT_BYTES', 2_000_000, 1_024, 20_000_000),
  };
}

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/server/config';
import { createLogger } from '../src/server/logger';

describe('server configuration', () => {
  it('uses safe defaults when nothing is set', () => {
    expect(loadConfig({})).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      corsOrigins: [],
      trustProxy: false,
      defaultSimulationWorkers: 500,
      maxTraceEvents: 10_000,
    });
  });

  it.each([
    [{ PORT: 'abc' }, /PORT must be an integer/],
    [{ PORT: '70000' }, /PORT must be between/],
    [{ LOG_LEVEL: 'loud' }, /LOG_LEVEL must be one of/],
    [{ TRUST_PROXY: 'maybe' }, /TRUST_PROXY must be/],
    [{ CORS_ORIGIN: '*' }, /not allowed/],
    [{ CORS_ORIGIN: 'not a url' }, /invalid origin/],
    [{ SIMULATION_WORKERS: '900', MAX_SIMULATION_WORKERS: '100' }, /must not exceed/],
  ])('rejects invalid configuration %j', (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('parses explicit CORS origins', () => {
    expect(loadConfig({ CORS_ORIGIN: 'https://a.example, https://b.example' }).corsOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('structured logger', () => {
  it('writes one JSON object per line and respects the level', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (line) => lines.push(line));
    logger.info('ignored');
    logger.warn('kept', { requestId: 'r1' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', msg: 'kept', requestId: 'r1' });
  });
});

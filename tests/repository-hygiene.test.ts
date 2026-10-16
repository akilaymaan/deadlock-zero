import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const all = files(ROOT);
const shipped = all.filter((path) => relative(ROOT, path).startsWith(`src${sep}`));

describe('repository layout', () => {
  it('contains the files a contributor and a deployer need', () => {
    for (const file of [
      '.gitignore', '.gitattributes', '.dockerignore', '.nvmrc', '.env.example', 'Dockerfile',
      'LICENSE', 'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CHANGELOG.md',
      '.github/workflows/ci.yml', '.github/pull_request_template.md',
      'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html',
    ]) {
      expect(existsSync(resolve(ROOT, file)), `missing ${file}`).toBe(true);
    }
  });

  it('pins the runtime and declares safe scripts', () => {
    expect(read('.nvmrc').trim()).toBe('22.19.0');
    const pkg = JSON.parse(read('package.json')) as { engines: { node: string }; scripts: Record<string, string>; license: string };
    expect(pkg.engines.node).toBe('>=22.0.0');
    expect(pkg.license).toBe('MIT');
    expect(pkg.scripts.start).toBe('node dist/server/index.js');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(JSON.parse(read('package-lock.json')).lockfileVersion).toBeGreaterThanOrEqual(2);
  });

  it('keeps Linux portability settings', () => {
    expect(read('.gitattributes')).toContain('* text=auto eol=lf');
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.forceConsistentCasingInFileNames).toBe(true);
    for (const pattern of ['node_modules', 'dist', 'coverage', '.env']) {
      expect(read('.gitignore')).toContain(pattern);
      expect(read('.dockerignore')).toContain(pattern);
    }
  });

  it('builds a non-root production image with a health check', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('FROM node:22.19.0-bookworm-slim');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('EXPOSE 3000');
  });

  it('documents every environment variable the server reads', () => {
    const example = read('.env.example');
    const used = new Set([...read('src/server/config.ts').matchAll(/['"]([A-Z][A-Z0-9_]+)['"]/g)].map((match) => match[1]));
    used.add('PORT');
    used.add('HOST');
    used.add('NODE_ENV');
    used.add('LOG_LEVEL');
    used.add('CORS_ORIGIN');
    for (const name of used) expect(example, `${name} missing from .env.example`).toMatch(new RegExp(`^${name}=`, 'm'));
  });
});

describe('no demo or fabricated content ships', () => {
  it('has no preset scenarios, demo fixtures, or legacy demo UI in src/', () => {
    expect(existsSync(resolve(ROOT, 'src/scenarios'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/components'))).toBe(false);
    const banned = /DEMO_|INCIDENT_PRESETS|lorem ipsum|prod-eu-west|INC-\d{3,}|OPERATOR \/|hashStringSeed|SAMPLE_SCHEMA_TEMPLATE/i;
    for (const path of shipped) {
      expect(banned.test(readFileSync(path, 'utf8')), `demo marker in ${relative(ROOT, path)}`).toBe(false);
    }
  });
});

describe('no secrets or machine paths are committed', () => {
  it('scans every tracked-style file', () => {
    const machinePath = new RegExp(['[A-Z]:\\\\(Users|code)\\\\', '(^|[^a-z0-9_])/(Users|home)/[a-z0-9_.-]+'].join('|'), 'i');
    const secret = new RegExp(
      ['sk-[A-Za-z0-9]{20,}', 'ghp_[A-Za-z0-9]{20,}', 'AIza[0-9A-Za-z_-]{30,}', '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'].join('|'),
    );
    expect(all.length).toBeGreaterThan(20);
    for (const path of all) {
      const content = readFileSync(path, 'utf8');
      expect(machinePath.test(content), `machine path in ${relative(ROOT, path)}`).toBe(false);
      expect(secret.test(content), `possible secret in ${relative(ROOT, path)}`).toBe(false);
    }
  });
});

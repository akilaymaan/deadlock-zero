import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);

function collectRepoFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectRepoFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Clean-Room Linux Rebuild Audit', () => {
  it('includes all required clean-room configuration and packaging files', () => {
    const requiredFiles = [
      '.gitignore',
      '.gitattributes',
      '.dockerignore',
      '.nvmrc',
      '.env.example',
      'Dockerfile',
      'README.md',
      'package.json',
      'package-lock.json',
      'postcss.config.js',
      'tailwind.config.js',
      'tsconfig.json',
      'tsconfig.server.json',
      'vite.config.ts',
      'src/shared/types.ts',
      'src/engine/graph.ts',
      'src/engine/deadlockDetector.ts',
      'src/engine/raceDetector.ts',
      'src/engine/simulator.ts',
      'src/engine/remediator.ts',
      'src/scenarios/presets.ts',
      'src/server/app.ts',
      'src/server/index.ts',
      'src/client/main.tsx',
      'src/client/App.tsx',
      'src/client/index.css',
      'src/client/components/LockGraphCanvas.tsx',
      'src/client/components/CodeAndDiffPanel.tsx',
      'src/client/components/ChaosBenchmarkBar.tsx',
      'src/client/components/CustomTraceModal.tsx',
      'tests/engine.test.ts',
      'tests/api.test.ts',
      'tests/linux-rebuild-audit.test.ts',
    ];

    for (const file of requiredFiles) {
      expect(existsSync(resolve(REPO_ROOT, file)), `Missing required file: ${file}`).toBe(true);
    }
  });

  it('pins Node.js runtime in .nvmrc and package.json engines', () => {
    const nvmrc = readFileSync(resolve(REPO_ROOT, '.nvmrc'), 'utf8').trim();
    expect(nvmrc).toBe('22.19.0');

    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
      scripts?: Record<string, string>;
    };
    expect(pkg.engines?.node).toBe('>=22.0.0');
    expect(pkg.scripts?.build).toBeDefined();
    expect(pkg.scripts?.start).toBeDefined();
    expect(pkg.scripts?.test).toBe('vitest run');

    const lockfile = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
      lockfileVersion?: number;
    };
    expect(lockfile.lockfileVersion).toBeGreaterThanOrEqual(2);
  });

  it('configures .gitignore, .dockerignore, .gitattributes, and tsconfig.json for Linux portability', () => {
    const gitignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('dist');
    expect(gitignore).toContain('coverage');
    expect(gitignore).toContain('.env');

    const dockerignore = readFileSync(resolve(REPO_ROOT, '.dockerignore'), 'utf8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('dist');
    expect(dockerignore).toContain('.env');

    const gitattributes = readFileSync(resolve(REPO_ROOT, '.gitattributes'), 'utf8');
    expect(gitattributes).toContain('* text=auto eol=lf');

    const tsconfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { forceConsistentCasingInFileNames?: boolean };
    };
    expect(tsconfig.compilerOptions?.forceConsistentCasingInFileNames).toBe(true);
  });

  it('defines a production Linux Dockerfile based on node:22.19.0-bookworm-slim', () => {
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('FROM node:22.19.0-bookworm-slim');
    expect(dockerfile).toContain('npm ci');
    expect(dockerfile).toContain('npm test');
    expect(dockerfile).toContain('npm run build');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('CMD ["npm", "start"]');
  });

  it('provides safe non-secret defaults in .env.example', () => {
    const envExample = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8');
    expect(envExample).toContain('PORT=3000');
    expect(envExample).toContain('HOST=0.0.0.0');
    expect(envExample).toContain('NODE_ENV=production');
    expect(envExample).toContain('SIMULATION_WORKERS=500');
  });

  it('documents architecture, algorithms, setup, test, Docker, and all 6 milestones in README.md', () => {
    const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('Tarjan');
    expect(readme).toContain('Vector Clock');
    expect(readme).toContain('cp .env.example .env && npm ci && npm run build && npm start');
    expect(readme).toContain('npm test');
    expect(readme).toContain(
      'docker build -t deadlock-zero . && docker run --rm -p 3000:3000 --env-file .env.example deadlock-zero',
    );
    expect(readme).toContain('Milestone 1: Core Wait-For Graph (WFG) Data Structures & Runtime Pinning');
    expect(readme).toContain("Milestone 2: Tarjan's SCC Deadlock Detector & Lamport Vector-Clock Race Verifier");
    expect(readme).toContain(
      'Milestone 3: 500-Worker Chaos Simulator, Canonical Lock-Order Remediator & 5 Outage Scenarios',
    );
    expect(readme).toContain('Milestone 4: Express REST API & Custom Lock-Trace Parser');
    expect(readme).toContain(
      'Milestone 5: Interactive Dark-Mode SRE War-Room Dashboard (React + Tailwind + SVG Graph)',
    );
    expect(readme).toContain('Milestone 6: Clean-Room Linux Dockerization & Automated Rebuild Audit');
  });

  it('contains zero hardcoded host machine paths or secrets across the entire repository', () => {
    const files = collectRepoFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const winUsersPattern = new RegExp(['[A-Z]:', '\\\\Users\\\\'].join(''), 'i');
    const winCodePattern = new RegExp(['[A-Z]:', '\\\\code\\\\'].join(''), 'i');
    const macUsersPattern = new RegExp(['(^|[^a-z0-9_])', '/Users/', '[a-z0-9_.-]+'].join(''), 'i');
    const linuxHomePattern = new RegExp(['(^|[^a-z0-9_])', '/home/', '[a-z0-9_.-]+'].join(''), 'i');
    const secretPattern = new RegExp(
      [
        '(',
        ['sk-', '[A-Za-z0-9]{20,}'].join(''),
        '|',
        ['ghp_', '[A-Za-z0-9]{20,}'].join(''),
        '|',
        ['AIza', '[0-9A-Za-z_-]{30,}'].join(''),
        '|',
        ['-----BEGIN ', '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----'].join(''),
        ')',
      ].join(''),
    );

    for (const filePath of files) {
      const relPath = relative(REPO_ROOT, filePath);
      const content = readFileSync(filePath, 'utf8');

      expect(winUsersPattern.test(content), `Hardcoded Windows user path in ${relPath}`).toBe(false);
      expect(winCodePattern.test(content), `Hardcoded Windows workspace path in ${relPath}`).toBe(false);
      expect(macUsersPattern.test(content), `Hardcoded macOS user path in ${relPath}`).toBe(false);
      expect(linuxHomePattern.test(content), `Hardcoded Linux home path in ${relPath}`).toBe(false);
      expect(secretPattern.test(content), `Potential secret or private key in ${relPath}`).toBe(false);
    }
  });
});

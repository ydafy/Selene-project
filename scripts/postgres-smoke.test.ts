import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const composePath = `${root}docker-compose.postgres-test.yml`;

interface Compose {
  name?: string;
  services: Record<
    string,
    {
      image: string;
      container_name?: string;
      ports: string[];
      environment: Record<string, string>;
      healthcheck: { test: string[]; retries: number };
      volumes: string[];
    }
  >;
  volumes: Record<string, Record<string, never>>;
}

function config() {
  return Bun.YAML.parse(readFileSync(composePath, 'utf8')) as Compose;
}

test.each([
  [
    'db:test:up',
    'docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations up -d --wait --wait-timeout 90',
  ],
  ['db:test:check', 'bun scripts/postgres-smoke.ts'],
  [
    'db:test:stop',
    'docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations stop',
  ],
])('%s exposes the existing non-destructive test workflow', (name, command) => {
  const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
  expect(manifest.scripts[name]).toBe(command);
});

test('only a pinned PostgreSQL service is configured', () => {
  const compose = config();
  expect(Object.keys(compose.services)).toEqual(['postgres']);
  expect(compose.services.postgres.image).toBe('postgres:17.6-bookworm');
  expect(compose.services.postgres.container_name).toBeUndefined();
});

test('port binds only loopback and supports a dedicated port override', () => {
  expect(config().services.postgres.ports).toEqual([
    '127.0.0.1:${SELENE_TEST_PG_PORT:-55432}:5432',
  ]);
});

test('healthcheck targets the disposable database with local-only credentials', () => {
  const service = config().services.postgres;
  expect(service.environment).toEqual({
    POSTGRES_DB: 'selene_test',
    POSTGRES_USER: 'selene_test',
    POSTGRES_PASSWORD: 'selene_local_test_only',
    POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256',
  });
  expect(service.healthcheck.test).toEqual([
    'CMD-SHELL',
    'pg_isready -U selene_test -d selene_test',
  ]);
  expect(service.healthcheck.retries).toBeGreaterThan(0);
});

test('data has a project-scoped volume, not a host or external mount', () => {
  const compose = config();
  expect(compose.services.postgres.volumes).toEqual([
    'postgres-test-data:/var/lib/postgresql/data',
  ]);
  expect(compose.volumes).toEqual({ 'postgres-test-data': {} });
  expect(compose.name).toBeUndefined();
});

test('probe documents its scope without opening a connection', () => {
  const result = Bun.spawnSync(['bun', 'scripts/postgres-smoke.ts', '--help'], {
    cwd: root,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(
    'Usage: bun scripts/postgres-smoke.ts [--help]\n' +
      'Local infrastructure only: readiness, distinct sessions, row-lock rejection and recovery.\n' +
      'SELENE_TEST_PG_PORT defaults to 55432. Host, database and credentials are local-test-only.\n',
  );
  expect(result.stderr.toString()).toBe('');
});

test('invalid port fails before any connection', () => {
  const result = Bun.spawnSync(['bun', 'scripts/postgres-smoke.ts'], {
    cwd: root,
    env: { ...process.env, SELENE_TEST_PG_PORT: '0' },
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  expect(result.stderr.toString()).toBe(
    'FAIL: SELENE_TEST_PG_PORT must be an integer between 1 and 65535.\n',
  );
});

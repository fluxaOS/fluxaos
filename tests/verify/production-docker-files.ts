import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

function read(filePath: string): string {
  return fs.readFileSync(path.join(root, filePath), 'utf8');
}

function assertIncludes(file: string, content: string, expected: string): void {
  if (!content.includes(expected)) {
    throw new Error(`${file} is missing expected content: ${expected}`);
  }
}

function assertExcludes(
  file: string,
  content: string,
  forbidden: string
): void {
  if (content.includes(forbidden)) {
    throw new Error(`${file} contains forbidden content: ${forbidden}`);
  }
}

function assertLine(file: string, content: string, expected: string): void {
  const lines = content.split(/\r?\n/);
  if (!lines.includes(expected)) {
    throw new Error(`${file} is missing expected line: ${expected}`);
  }
}

function assertOrder(
  file: string,
  content: string,
  earlier: string,
  later: string
): void {
  const earlierIndex = content.indexOf(earlier);
  const laterIndex = content.indexOf(later);
  if (earlierIndex === -1) {
    throw new Error(`${file} is missing expected content: ${earlier}`);
  }
  if (laterIndex === -1) {
    throw new Error(`${file} is missing expected content: ${later}`);
  }
  if (earlierIndex > laterIndex) {
    throw new Error(`${file} must check ${earlier} before ${later}`);
  }
}

function serviceBlock(normalizedCompose: string, serviceName: string): string {
  const marker = `  ${serviceName}:\n`;
  const start = normalizedCompose.indexOf(marker);
  if (start === -1) {
    throw new Error(`docker compose config missing service ${serviceName}`);
  }

  const rest = normalizedCompose.slice(start + marker.length);
  const nextService = rest.search(/\n {2}[a-zA-Z0-9_-]+:\n/);
  return nextService === -1 ? rest : rest.slice(0, nextService);
}

const dockerfile = read('Dockerfile');
assertIncludes('Dockerfile', dockerfile, 'RUN npm run build:prod');
assertIncludes(
  'Dockerfile',
  dockerfile,
  'COPY --from=builder /app/.next/daemon ./.next/daemon'
);
assertIncludes(
  'Dockerfile',
  dockerfile,
  'RUN apk add --no-cache bash curl git openssh-client'
);
assertIncludes(
  'Dockerfile',
  dockerfile,
  'RUN npm install -g @anthropic-ai/claude-code@'
);
assertExcludes('Dockerfile', dockerfile, 'drizzle.config.ts');

const dockerignore = read('.dockerignore');
for (const expected of [
  '.env',
  '.env.*',
  '.git',
  'node_modules',
  '.next',
  '.worktrees',
  '.fluxaos-worktrees',
  '.fluxaos-artifacts',
]) {
  assertLine('.dockerignore', dockerignore, expected);
}

const rootPage = read('src/app/page.tsx');
assertIncludes(
  'src/app/page.tsx',
  rootPage,
  "export const dynamic = 'force-dynamic';"
);

const compose = read('ops/docker/homelab/docker-compose.yml');
for (const expected of [
  'fluxaos-web:',
  'fluxaos-daemon:',
  'external: true',
  '/mnt/stacks/docker/fluxaos/repos:/repos',
  '/mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees',
  '/mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts',
  'stop_grace_period: 120s',
  'command: ["node", ".next/daemon/daemon.mjs"]',
]) {
  assertIncludes('ops/docker/homelab/docker-compose.yml', compose, expected);
}
assertExcludes('ops/docker/homelab/docker-compose.yml', compose, 'depends_on:');
assertExcludes('ops/docker/homelab/docker-compose.yml', compose, 'redis:7');

const env = read('ops/docker/homelab/fluxaos.env.example');
for (const expected of [
  'REDIS_URL=redis://central_redis:6379',
  'FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos',
  'FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees',
  'FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts',
  'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=120',
]) {
  assertIncludes('ops/docker/homelab/fluxaos.env.example', env, expected);
}

const shellExpansion = (name: string): string => `$\{${name}}`;
const buildScript = read('ops/docker/homelab/build.sh');
for (const expected of [
  `STACK_DIR="${shellExpansion('STACK_DIR:-/mnt/stacks/docker/fluxaos')}"`,
  `realpath -m "${shellExpansion('STACK_DIR')}"`,
  'SOURCE_DIR must not resolve into a development checkout',
  'ENV_FILE must resolve to /mnt/stacks/docker/fluxaos/fluxaos.env',
  'DEPLOYED_SHA_FILE must resolve to /mnt/stacks/docker/fluxaos/deployed-sha',
  'ROLLBACK_DIR must resolve to /mnt/stacks/docker/fluxaos/rollback',
  'docker network inspect homelab',
  'central_redis is not attached to the homelab network',
  'docker exec central_redis redis-cli ping',
  'REDIS_URL must be redis://central_redis:6379',
  'FLUXAOS_TARGET_REPO_PATH must not contain',
  'target repo escaped stack repos dir',
  `git -C "${shellExpansion('host_target')}" rev-parse --is-inside-work-tree`,
  'FLUXAOS_WORKSPACE_ROOT must be /runtime/worktrees',
  'FLUXAOS_ARTIFACTS_ROOT must be /runtime/artifacts',
  'runtime directory is not writable',
  'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS must be 120',
  'Rollback marker:',
  '--force-recreate',
  'docker compose run --rm --no-deps fluxaos-web sh -lc',
  `docker logs --since "${shellExpansion('DEPLOY_STARTED_AT')}" "${shellExpansion(
    'DAEMON_CONTAINER_ID'
  )}"`,
  'DAEMON_LOGS=',
  'git status --short',
  `-t "fluxaos:${shellExpansion('TARGET_SHA')}"`,
  `-t "fluxaos:${shellExpansion('IMAGE_CHANNEL')}"`,
  'docker compose run --rm fluxaos-web npm run db:migrate:prod',
]) {
  assertIncludes('ops/docker/homelab/build.sh', buildScript, expected);
}

const preCommit = read('ops/git-hooks/pre-commit');
for (const expected of ['secrets/', '\\.token$', '\\.env\\.example$']) {
  assertIncludes('ops/git-hooks/pre-commit', preCommit, expected);
}
assertOrder(
  'ops/git-hooks/pre-commit',
  preCommit,
  'secrets/',
  '\\.env\\.example$'
);
assertOrder(
  'ops/git-hooks/pre-commit',
  preCommit,
  '\\.token$',
  '\\.env\\.example$'
);

const tempEnvPath = path.join(root, 'ops/docker/homelab/fluxaos.env');
fs.copyFileSync(
  path.join(root, 'ops/docker/homelab/fluxaos.env.example'),
  tempEnvPath
);

try {
  const normalizedCompose = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'ops/docker/homelab/docker-compose.yml',
      '--env-file',
      'ops/docker/homelab/fluxaos.env',
      'config',
    ],
    { cwd: root, encoding: 'utf8' }
  );

  const requiredEnv = [
    'DATABASE_URL:',
    'DIRECT_URL:',
    'NEXT_PUBLIC_SUPABASE_URL:',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:',
    'SUPABASE_SERVICE_ROLE_KEY:',
    'ANTHROPIC_API_KEY:',
    'FLUXAOS_GITHUB_TOKEN:',
    'REDIS_URL:',
    'FLUXAOS_TARGET_REPO_PATH:',
    'FLUXAOS_WORKSPACE_ROOT:',
    'FLUXAOS_ARTIFACTS_ROOT:',
    'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS:',
    'FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN:',
    'FLUXAOS_CLEANUP_STALE_DAYS:',
    'FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS:',
    'FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS:',
  ];

  const webBlock = serviceBlock(normalizedCompose, 'fluxaos-web');
  const daemonBlock = serviceBlock(normalizedCompose, 'fluxaos-daemon');

  for (const [service, block] of [
    ['fluxaos-web', webBlock],
    ['fluxaos-daemon', daemonBlock],
  ]) {
    for (const key of requiredEnv) {
      assertIncludes(`docker compose config service ${service}`, block, key);
    }
  }

  assertIncludes('docker compose config', daemonBlock, '- node');
  assertIncludes(
    'docker compose config',
    daemonBlock,
    '- .next/daemon/daemon.mjs'
  );
} finally {
  fs.rmSync(tempEnvPath, { force: true });
}

console.log('production Docker files verified');

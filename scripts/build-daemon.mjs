import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const outdir = resolve(root, '.next/daemon');

async function resolveAliasPath(importPath) {
  const base = resolve(root, 'src', importPath.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
  ];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // Keep probing candidates until one exists.
    }
  }

  return base;
}

const aliasPlugin = {
  name: 'fluxaos-path-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => ({
      path: await resolveAliasPath(args.path),
    }));
  },
};

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    daemon: resolve(root, 'src/scripts/daemon.ts'),
    'migrate-prod': resolve(root, 'src/scripts/db/migrate-prod.ts'),
    'init-result-doc': resolve(root, 'src/scripts/pipeline/init-result-doc.ts'),
    'ingest-result-doc': resolve(
      root,
      'src/scripts/pipeline/ingest-result-doc.ts'
    ),
  },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  sourcemap: true,
  plugins: [aliasPlugin],
  logLevel: 'info',
});

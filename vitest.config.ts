import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // FLX-275: every integration suite hits the SAME real Supabase database
    // (project policy: no mocks, no per-worker DBs), and the product owns
    // true global singletons that suites must exercise as part of their
    // contract:
    //   - global config_entry rows (runtime.workspace_root,
    //     runtime.artifacts_root, cleanup.*) that runtime-*.test.ts and the
    //     cleanup suites mutate and even delete (missing-row fail-fast
    //     branches),
    //   - the global pipeline-run concurrency slots + advisory lock
    //     (tryAcquireRunningSlot counts status='running' across ALL rows),
    //   - cleanup sweeps that iterate every isolation_environment row in
    //     the DB.
    // Running test FILES in parallel against that shared mutable state is
    // unsound by construction: suites observed each other's config
    // mutations (MissingGlobalConfigError mid-suite), starved each other's
    // concurrency slots (runs stuck 'pending'), and swept each other's
    // fixtures. Serializing files is the root-cause fix — one writer at a
    // time on shared global state. Tests within a file already run
    // sequentially, so this changes scheduling only across files.
    fileParallelism: false,
    exclude: [
      '**/node_modules/**',
      'dist',
      '.next',
      'e2e/**',
      'website/**',
      '.worktrees/**',
      '.fluxaos-worktrees/**',
      // Parallel-agent worktrees live under .claude/worktrees/. Each has
      // its own copy of src/ and would otherwise be picked up by vitest's
      // test-discovery glob, multiplying the test run by the number of
      // active agents and producing cross-worktree DB races.
      '.claude/worktrees/**',
    ],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});

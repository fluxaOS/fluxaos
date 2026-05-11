import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
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

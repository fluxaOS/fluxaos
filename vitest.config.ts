import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', 'dist', '.next', 'e2e/**', 'website/**'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { WorkspaceMaterializerPort } from '@/core/ports/workspace-materializer';

export const fsMaterializerAdapter: WorkspaceMaterializerPort = {
  async writeFile(path: string, content: string): Promise<void> {
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, path);
  },

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  },

  async rmdir(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  },

  tmpdir(): string {
    return tmpdir();
  },
};

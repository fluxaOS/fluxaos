import { access, readdir, readFile } from 'fs/promises';
import { extname, join } from 'path';
import { type Playbook, parsePlaybook } from './playbook';

export type PlaybookScope = 'bundled' | 'org' | 'project';

export interface DiscoveredPlaybook {
  filename: string;
  scope: PlaybookScope;
  playbook: Playbook;
  filePath: string;
}

export interface DiscoveryOptions {
  bundledDir?: string;
  orgDir?: string;
  projectDir?: string;
}

async function loadFromDir(
  dir: string,
  scope: PlaybookScope
): Promise<Map<string, DiscoveredPlaybook>> {
  const map = new Map<string, DiscoveredPlaybook>();
  try {
    await access(dir);
  } catch {
    return map;
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return map;
  }

  for (const entry of entries) {
    const ext = extname(entry);
    if (ext !== '.yaml' && ext !== '.yml') continue;
    const filePath = join(dir, entry);
    try {
      const content = await readFile(filePath, 'utf-8');
      const result = parsePlaybook(content, entry);
      if (result.success) {
        map.set(entry, {
          filename: entry,
          scope,
          playbook: result.playbook,
          filePath,
        });
      }
    } catch {
      // silently skip unreadable files
    }
  }
  return map;
}

export async function discoverPlaybooks(
  opts: DiscoveryOptions
): Promise<DiscoveredPlaybook[]> {
  const merged = new Map<string, DiscoveredPlaybook>();

  // 1. bundled (lowest precedence)
  if (opts.bundledDir) {
    for (const [k, v] of await loadFromDir(opts.bundledDir, 'bundled'))
      merged.set(k, v);
  }
  // 2. org (overrides bundled)
  if (opts.orgDir) {
    for (const [k, v] of await loadFromDir(opts.orgDir, 'org'))
      merged.set(k, v);
  }
  // 3. project (overrides all)
  if (opts.projectDir) {
    for (const [k, v] of await loadFromDir(opts.projectDir, 'project'))
      merged.set(k, v);
  }

  return Array.from(merged.values());
}

export async function resolvePlaybook(
  name: string,
  opts: DiscoveryOptions
): Promise<DiscoveredPlaybook | null> {
  const all = await discoverPlaybooks(opts);
  return all.find((p) => p.playbook.name === name) ?? null;
}

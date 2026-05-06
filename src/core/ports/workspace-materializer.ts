export interface WorkspaceMaterializerPort {
  /**
   * Write content to a file in the workspace atomically (write-then-rename).
   * Creates parent directories as needed.
   */
  writeFile(path: string, content: string): Promise<void>;

  /** Create a directory (and any missing parents). Idempotent. */
  mkdir(path: string): Promise<void>;

  /** Remove a directory and all its contents. Tolerates a missing path. */
  rmdir(path: string): Promise<void>;

  /** Return the OS temp directory root (e.g. /tmp on Linux). */
  tmpdir(): string;
}

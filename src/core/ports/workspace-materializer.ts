export interface WorkspaceMaterializerPort {
  /**
   * Write content to a file atomically (write-then-rename).
   * The parent directory must already exist.
   */
  writeFile(path: string, content: string): Promise<void>;

  /** Create a directory (and any missing parents). Idempotent. */
  mkdir(path: string): Promise<void>;

  /** Remove a directory and all its contents. Tolerates a missing path. */
  rmdir(path: string): Promise<void>;

  /** Return the OS temp directory root (e.g. /tmp on Linux). */
  tmpdir(): string;
}

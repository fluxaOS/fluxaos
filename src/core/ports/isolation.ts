export interface IsolationEnvironment {
  id: string;
  projectId: string;
  runId: string;
  provider: string;
  workingPath: string;
  branchName: string;
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  /**
   * Absolute path to the run-scoped artifacts directory, or null for
   * environments acquired before R-ARTIFACTS (pre-migration 0008). Populated
   * by the isolation provider on acquire; survives release so later reads
   * and cleanup-service sweeps can locate it.
   */
  artifactsPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcquireEnvironmentParams {
  projectId: string;
  runId: string;
  repoPath: string;
  repoIdentity: { owner: string; repo: string };
  branchName: string;
  baseBranch?: string;
  copyFiles?: string[];
  /**
   * Optional caller-supplied artifacts directory. When omitted (the normal
   * path), the provider derives a default under the workspace root and
   * returns the resolved path on the IsolationEnvironment.
   */
  artifactsPath?: string;
}

export interface ReleaseOptions {
  force?: boolean;
}

export interface IsolationProvider {
  acquire(params: AcquireEnvironmentParams): Promise<IsolationEnvironment>;
  release(envId: string, options?: ReleaseOptions): Promise<void>;
  findActiveByRun(
    projectId: string,
    runId: string
  ): Promise<IsolationEnvironment | null>;
  listActiveByProject(projectId: string): Promise<IsolationEnvironment[]>;
}

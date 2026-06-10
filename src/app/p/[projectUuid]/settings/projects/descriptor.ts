// src/app/p/[projectUuid]/settings/projects/descriptor.ts
//
// FLX-207 / FLX-229: ProjectRecord carries the FK IDs directly. The
// descriptor itself is built per-render by buildProjectDescriptor() so
// dropdown options (loaded from tRPC) can be passed in. This file only
// exports the record type — there is no `projectDescriptor` constant
// any more.
//
// RecordEditor requires { id, version: number } per RecordWithVersion.
// The project table has no `version` column; the page hydrates with
// `version: 1` so optimistic-locking-free updates still satisfy the
// editor's type contract.
export type ProjectRecord = {
  id: string;
  version: number;
  name: string;
  repoUrl: string | null;
  defaultBranch: string;
  defaultPipelineId: string | null;
  brandId: string | null;
  targetRepoPath: string | null;
};

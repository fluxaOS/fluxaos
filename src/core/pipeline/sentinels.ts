/**
 * Pipeline routing sentinels — special stage name values stored in onPass/onFail/fallback
 * columns that trigger built-in orchestrator behavior instead of advancing to a named stage.
 */
export const PIPELINE_SENTINEL = {
  /** Pipeline finished successfully. */
  complete: '__complete__',
  /** Pipeline is blocked waiting on human input. */
  blocked: '__blocked__',
} as const;

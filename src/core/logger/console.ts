/**
 * Shared console logger — JSON-line output for daemon + tRPC.
 *
 * Satisfies PipelineTerminalHookLogger, CleanupLogger, and DeployBridgeLogger
 * interfaces (structurally identical: { info, warn, error } each taking
 * (obj, msg?)). One instance, one import, no per-call-site duplication.
 */

export interface ConsoleLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

function emit(
  level: 'info' | 'warn' | 'error',
  obj: Record<string, unknown>,
  msg?: string,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...obj,
    ...(msg !== undefined ? { msg } : {}),
  });
  if (level === 'info') console.log(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}

export const consoleLogger: ConsoleLogger = {
  info: (obj, msg) => emit('info', obj, msg),
  warn: (obj, msg) => emit('warn', obj, msg),
  error: (obj, msg) => emit('error', obj, msg),
};

export interface ExecuteParams {
	command: string;
	args: string[];
	cwd: string;
	env?: Record<string, string>;
	timeoutMs?: number;
	onStdout?: (data: string) => void;
	onStderr?: (data: string) => void;
}

export interface ExecuteResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	processId: string;
}

export interface StageExecutor {
	execute(params: ExecuteParams): Promise<ExecuteResult>;

	cancel(processId: string): Promise<void>;
}

export interface JobOptions {
	priority?: number;
	delay?: number;
	attempts?: number;
	backoff?: {
		type: "fixed" | "exponential";
		delay: number;
	};
}

export type JobStatus =
	| "waiting"
	| "active"
	| "completed"
	| "failed"
	| "delayed";

export interface Job<T = unknown> {
	id: string;
	data: T;
	status: JobStatus;
	progress: number;
	attempts: number;
	failedReason?: string;
}

export interface QueueProvider {
	enqueue<T>(
		queueName: string,
		jobId: string,
		data: T,
		opts?: JobOptions,
	): Promise<void>;

	process<T>(
		queueName: string,
		handler: (job: Job<T>) => Promise<void>,
	): void;

	getJob<T = unknown>(
		queueName: string,
		jobId: string,
	): Promise<Job<T> | null>;

	cancelJob(queueName: string, jobId: string): Promise<void>;
}

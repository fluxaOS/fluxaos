import type { Job as BullJob } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import type {
  Job,
  JobOptions,
  JobStatus,
  QueueProvider,
} from '@/core/ports/queue';

function getRedisConnection() {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

const STATUS_MAP: Record<string, JobStatus> = {
  waiting: 'waiting',
  active: 'active',
  completed: 'completed',
  failed: 'failed',
  delayed: 'delayed',
};

export class BullMQAdapter implements QueueProvider {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  private getQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, { connection: getRedisConnection() });
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  async enqueue<T>(
    queueName: string,
    jobId: string,
    data: T,
    opts?: JobOptions
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.add(jobId, data, {
      jobId,
      priority: opts?.priority,
      delay: opts?.delay,
      attempts: opts?.attempts ?? 1,
      backoff: opts?.backoff
        ? { type: opts.backoff.type, delay: opts.backoff.delay }
        : undefined,
    });
  }

  process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): void {
    if (this.workers.has(queueName)) {
      throw new Error(`Worker already registered for queue: ${queueName}`);
    }

    const worker = new Worker<T>(
      queueName,
      async (bullJob: BullJob<T>) => {
        const job: Job<T> = {
          id: bullJob.id ?? bullJob.name,
          data: bullJob.data,
          status: 'active',
          progress: 0,
          attempts: bullJob.attemptsMade,
        };
        await handler(job);
      },
      { connection: getRedisConnection(), concurrency: 1 }
    );

    this.workers.set(queueName, worker);
  }

  async getJob<T = unknown>(
    queueName: string,
    jobId: string
  ): Promise<Job<T> | null> {
    const queue = this.getQueue(queueName);
    const bullJob = await queue.getJob(jobId);
    if (!bullJob) return null;

    const state = await bullJob.getState();
    return {
      id: bullJob.id ?? bullJob.name,
      data: bullJob.data as T,
      status: STATUS_MAP[state] ?? 'waiting',
      progress: typeof bullJob.progress === 'number' ? bullJob.progress : 0,
      attempts: bullJob.attemptsMade,
      failedReason: bullJob.failedReason ?? undefined,
    };
  }

  async cancelJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const bullJob = await queue.getJob(jobId);
    if (bullJob) {
      await bullJob.remove();
    }
  }

  async close(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.workers.clear();
    this.queues.clear();
  }
}

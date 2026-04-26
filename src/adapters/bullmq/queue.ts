/**
 * BullMQ QueueProvider adapter.
 *
 * Implements the QueueProvider port using BullMQ + Redis.
 * Resolved via the registry — never imported directly.
 */
import { type Job as BullJob, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import Redis from 'ioredis';
import type {
  Job,
  JobOptions,
  JobStatus,
  QueueProvider,
} from '@/core/ports/queue';

function mapStatus(state: string): JobStatus {
  const mapping: Record<string, JobStatus> = {
    waiting: 'waiting',
    active: 'active',
    completed: 'completed',
    failed: 'failed',
    delayed: 'delayed',
  };
  return mapping[state] ?? 'waiting';
}

function mapJob<T>(bullJob: BullJob<T>): Job<T> {
  return {
    id: bullJob.id ?? '',
    data: bullJob.data,
    status: 'active',
    progress: typeof bullJob.progress === 'number' ? bullJob.progress : 0,
    attempts: bullJob.attemptsMade,
    failedReason: bullJob.failedReason ?? undefined,
  };
}

export class BullMQAdapter implements QueueProvider {
  private connection: IORedis | null = null;
  private redisUrl: string;
  private queues = new Map<string, Queue>();

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
    // Lazy connection — don't connect until first use.
    // Prevents ioredis errors when Redis isn't available (e.g., dev without Docker).
  }

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = new Redis(this.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
    }
    return this.connection;
  }

  private getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.getConnection() });
      this.queues.set(name, queue);
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
      attempts: opts?.attempts,
      backoff: opts?.backoff,
    });
  }

  process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): void {
    new Worker<T>(
      queueName,
      async (bullJob) => {
        await handler(mapJob(bullJob));
      },
      { connection: this.getConnection() }
    );
  }

  async getJob<T = unknown>(
    queueName: string,
    jobId: string
  ): Promise<Job<T> | null> {
    const queue = this.getQueue(queueName);
    const bullJob = await queue.getJob(jobId);
    if (!bullJob) return null;

    const state = await bullJob.getState();
    const job = mapJob<T>(bullJob as BullJob<T>);
    job.status = mapStatus(state);
    return job;
  }

  async cancelJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const conn = this.getConnection();
      await conn.connect();
      const result = await conn.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

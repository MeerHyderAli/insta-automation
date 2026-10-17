import type { Store } from '../db/store.js';
import type { LoggerLike } from '../lib/logger.js';
import { redactSecrets } from '../lib/redact.js';
import type { AutomationEngine } from './engine.js';

export interface WorkerOptions {
  pollIntervalMs: number;
  concurrency: number;
  maxAttempts: number;
  workerId?: string;
}

function backoffDelay(attempts: number): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(base * jitter);
}

/**
 * In-process worker that claims jobs from Postgres with SKIP LOCKED. Running
 * multiple API instances is safe for claiming; the local hourly private-reply
 * budget is per-instance (the DB count also applies).
 */
export class AutomationWorker {
  private readonly workerId: string;
  private stopping = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly store: Store,
    private readonly engine: AutomationEngine,
    private readonly logger: LoggerLike,
    private readonly options: WorkerOptions,
  ) {
    this.workerId = options.workerId ?? `worker-${process.pid}`;
  }

  start(): void {
    if (this.loops.length > 0) return;
    for (let index = 0; index < this.options.concurrency; index += 1) {
      this.loops.push(this.loop(`${this.workerId}-${index}`));
    }
    this.logger.info(
      { concurrency: this.options.concurrency, workerId: this.workerId },
      'Automation worker started',
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.loops);
    this.loops = [];
  }

  /** Claims and processes at most one job. Used by tests and the loop. */
  async runOnce(): Promise<boolean> {
    const job = await this.store.claimJob(this.workerId);
    if (!job) return false;
    this.logger.info(
      { jobId: job.id, eventId: job.webhookEventId, attempts: job.attempts },
      'Claimed automation job',
    );
    try {
      const outcome = await this.engine.processEvent(job.webhookEventId);
      if (outcome.result === 'completed') {
        await this.store.completeJob(job.id);
        return true;
      }
      if (outcome.result === 'dead') {
        await this.finalizeFailed(
          job.id,
          job.webhookEventId,
          outcome.reason ?? 'processing_failed',
        );
        return true;
      }
      const rescheduled = await this.store.rescheduleJob(
        job.id,
        new Date(Date.now() + backoffDelay(job.attempts)),
        outcome.reason ?? 'retryable_error',
      );
      if (rescheduled === 'dead') {
        await this.finalizeFailed(
          job.id,
          job.webhookEventId,
          `Retries exhausted (${outcome.reason ?? 'retryable_error'})`,
        );
      }
      return true;
    } catch (error) {
      const message = redactSecrets(
        error instanceof Error ? error.message : 'Unknown worker error',
      );
      this.logger.error(
        { jobId: job.id, eventId: job.webhookEventId, err: { message } },
        'Automation job failed',
      );
      try {
        const rescheduled = await this.store.rescheduleJob(
          job.id,
          new Date(Date.now() + backoffDelay(job.attempts)),
          message,
        );
        if (rescheduled === 'dead') {
          await this.finalizeFailed(job.id, job.webhookEventId, `Retries exhausted: ${message}`);
        }
      } catch (retryError) {
        this.logger.error(
          {
            jobId: job.id,
            err: {
              message: redactSecrets(
                retryError instanceof Error ? retryError.message : 'Unknown retry error',
              ),
            },
          },
          'Could not reschedule automation job',
        );
      }
      return true;
    }
  }

  private async finalizeFailed(jobId: string, eventId: string, reason: string): Promise<void> {
    await this.store.failJob(jobId, reason).catch(() => undefined);
    await this.store.updateWebhookEvent(eventId, 'failed', reason).catch(() => undefined);
    const run = await this.store.getRunForEvent(eventId).catch(() => null);
    if (run && ['queued', 'processing'].includes(run.status)) {
      await this.store
        .updateRun(run.id, { status: 'failed', skipReason: 'retry_exhausted' })
        .catch(() => undefined);
      await this.store
        .addRunEvent({
          runId: run.id,
          workspaceId: run.workspaceId,
          level: 'error',
          code: 'RETRIES_EXHAUSTED',
          message: redactSecrets(reason).slice(0, 500),
        })
        .catch(() => undefined);
    }
    this.logger.warn({ jobId, eventId, reason }, 'Automation job permanently failed');
  }

  private async loop(name: string): Promise<void> {
    while (!this.stopping) {
      let processed = false;
      try {
        processed = await this.runOnce();
      } catch (error) {
        this.logger.error(
          {
            worker: name,
            err: {
              message: redactSecrets(error instanceof Error ? error.message : 'Unknown error'),
            },
          },
          'Worker iteration failed',
        );
      }
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs));
      }
    }
  }
}

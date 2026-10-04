import type { Logger } from '../services/wallet.js';

/**
 * Runs `task` every `intervalMs`, never overlapping with itself.
 * Safe to run on several replicas: the tasks rely on row-level claims in Postgres.
 */
export function every(name: string, intervalMs: number, task: () => Promise<void>, log: Logger): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const tick = async () => {
    try {
      await task();
    } catch (err) {
      log.error({ err, job: name }, 'background job failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

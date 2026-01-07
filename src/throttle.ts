/**
 * Connection throttling to prevent overwhelming the upstream proxy.
 *
 * This module provides a simple semaphore-based connection limiter that
 * queues excess connections when the limit is reached.
 */

type QueuedRequest = {
  resolve: () => void;
  timestamp: number;
};

/**
 * Connection limiter that restricts concurrent connections.
 * When the limit is reached, new requests are queued until a slot opens.
 */
export class ConnectionLimiter {
  private activeCount = 0;
  private queue: QueuedRequest[] = [];
  private readonly maxConcurrent: number;
  private readonly verbose: boolean;

  constructor(maxConcurrent: number, verbose = false) {
    this.maxConcurrent = maxConcurrent;
    this.verbose = verbose;
  }

  /**
   * Check if throttling is enabled.
   */
  isEnabled(): boolean {
    return this.maxConcurrent > 0;
  }

  /**
   * Get current stats for logging.
   */
  getStats(): { active: number; queued: number; max: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      max: this.maxConcurrent,
    };
  }

  /**
   * Acquire a connection slot. Resolves immediately if under limit,
   * otherwise waits in queue until a slot is available.
   */
  async acquire(): Promise<void> {
    // If throttling is disabled, always allow
    if (!this.isEnabled()) {
      this.activeCount++;
      return;
    }

    // If under limit, acquire immediately
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      if (this.verbose) {
        console.log(`[throttle] Acquired slot (${this.activeCount}/${this.maxConcurrent})`);
      }
      return;
    }

    // At limit, queue the request
    if (this.verbose) {
      console.log(
        `[throttle] At limit, queueing request (active=${this.activeCount}, queued=${this.queue.length})`
      );
    }

    return new Promise<void>((resolve) => {
      this.queue.push({
        resolve,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Release a connection slot. If there are queued requests,
   * the next one in line is granted the slot.
   */
  release(): void {
    // If throttling is disabled, just decrement
    if (!this.isEnabled()) {
      this.activeCount = Math.max(0, this.activeCount - 1);
      return;
    }

    // Check if there's a queued request waiting
    const next = this.queue.shift();
    if (next) {
      // Transfer the slot to the queued request
      const waitTime = Date.now() - next.timestamp;
      if (this.verbose) {
        console.log(
          `[throttle] Slot released, granting to queued request (waited ${waitTime}ms, queued=${this.queue.length})`
        );
      }
      next.resolve();
    } else {
      // No one waiting, just decrement
      this.activeCount = Math.max(0, this.activeCount - 1);
      if (this.verbose) {
        console.log(`[throttle] Slot released (${this.activeCount}/${this.maxConcurrent})`);
      }
    }
  }
}

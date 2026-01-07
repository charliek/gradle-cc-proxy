import { describe, expect, test } from "bun:test";
import { ConnectionLimiter } from "../throttle";

describe("ConnectionLimiter", () => {
  test("isEnabled returns false when maxConcurrent is 0", () => {
    const limiter = new ConnectionLimiter(0);
    expect(limiter.isEnabled()).toBe(false);
  });

  test("isEnabled returns true when maxConcurrent > 0", () => {
    const limiter = new ConnectionLimiter(5);
    expect(limiter.isEnabled()).toBe(true);
  });

  test("getStats returns correct initial values", () => {
    const limiter = new ConnectionLimiter(3);
    const stats = limiter.getStats();
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.max).toBe(3);
  });

  test("acquire increments active count when under limit", async () => {
    const limiter = new ConnectionLimiter(3);
    await limiter.acquire();
    expect(limiter.getStats().active).toBe(1);
    await limiter.acquire();
    expect(limiter.getStats().active).toBe(2);
  });

  test("release decrements active count", async () => {
    const limiter = new ConnectionLimiter(3);
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.getStats().active).toBe(2);
    limiter.release();
    expect(limiter.getStats().active).toBe(1);
    limiter.release();
    expect(limiter.getStats().active).toBe(0);
  });

  test("acquire queues when at limit", async () => {
    const limiter = new ConnectionLimiter(2);

    // Fill to capacity
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.getStats().active).toBe(2);

    // This should queue
    let resolved = false;
    const queuedPromise = limiter.acquire().then(() => {
      resolved = true;
    });

    // Give it a tick to queue
    await new Promise((r) => setTimeout(r, 10));
    expect(limiter.getStats().queued).toBe(1);
    expect(resolved).toBe(false);

    // Release should grant slot to queued request
    limiter.release();
    await queuedPromise;
    expect(resolved).toBe(true);
    expect(limiter.getStats().queued).toBe(0);
  });

  test("unlimited mode (0) allows all acquires immediately", async () => {
    const limiter = new ConnectionLimiter(0);

    // Should all complete immediately
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);

    // Active should track even when unlimited
    expect(limiter.getStats().active).toBe(5);
  });

  test("release handles multiple queued requests in order", async () => {
    const limiter = new ConnectionLimiter(1);
    const order: number[] = [];

    await limiter.acquire();

    // Queue multiple requests
    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));

    await new Promise((r) => setTimeout(r, 10));
    expect(limiter.getStats().queued).toBe(3);

    // Release each slot - should be FIFO
    limiter.release();
    await p1;
    limiter.release();
    await p2;
    limiter.release();
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  test("release does not go below zero", () => {
    const limiter = new ConnectionLimiter(2);
    limiter.release();
    limiter.release();
    limiter.release();
    expect(limiter.getStats().active).toBe(0);
  });
});

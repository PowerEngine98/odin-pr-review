export class Lanes {
  private urgent = 0;
  private running = -1;
  private round = 0;
  private queue: (() => Promise<unknown>)[] = [];

  async now<T>(task: () => Promise<T>): Promise<T> {
    this.urgent += 1;
    try {
      return await task();
    } finally {
      this.urgent -= 1;
      this.pump();
    }
  }

  later(task: () => Promise<unknown>): void {
    this.queue.push(task);
    this.pump();
  }

  clear(): void {
    this.queue = [];
    this.round += 1;
  }

  get waiting(): number {
    return this.queue.length;
  }

  private pump(): void {
    if (this.running === this.round || this.urgent > 0) return;
    const next = this.queue.shift();
    if (!next) return;
    const round = this.round;
    this.running = round;
    void next()
      .catch(() => undefined)
      .finally(() => {
        if (this.running === round) this.running = -1;
        this.pump();
      });
  }
}

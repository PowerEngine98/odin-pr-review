export class Lanes {
  private urgent = 0;
  private running = false;
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
  }

  get waiting(): number {
    return this.queue.length;
  }

  private pump(): void {
    if (this.running || this.urgent > 0) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    void next()
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }
}

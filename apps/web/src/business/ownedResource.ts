export class AsyncResourceOwner {
  private generation = 0;
  private closed = false;
  private cleanup: (() => void) | undefined;
  async replace(
    load: (isCurrent: () => boolean) => Promise<(() => void) | undefined>,
  ): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.cleanup?.();
    this.cleanup = undefined;
    const current = () => !this.closed && generation === this.generation;
    const cleanup = await load(current);
    if (!cleanup) return;
    if (current()) this.cleanup = cleanup;
    else cleanup();
  }
  dispose() {
    this.closed = true;
    this.generation++;
    this.cleanup?.();
    this.cleanup = undefined;
  }
}

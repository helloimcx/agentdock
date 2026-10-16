/** At most one timer per thread; boundaries synchronously flush or discard it. */
export class AssistantPartialPersistence {
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; write: () => void }>();
  constructor(private readonly onError: (error: unknown) => void) {}
  schedule(threadId: string, write: () => void) {
    const prior = this.pending.get(threadId);
    if (prior) { prior.write = write; return; }
    const entry = { timer: setTimeout(() => {
      this.pending.delete(threadId);
      try { entry.write(); } catch (error) { this.onError(error); }
    }, 100), write };
    this.pending.set(threadId, entry);
  }
  discard(threadId: string) {
    const entry = this.pending.get(threadId);
    if (entry) clearTimeout(entry.timer);
    this.pending.delete(threadId);
  }
  flush(threadId: string) {
    const entry = this.pending.get(threadId);
    this.discard(threadId);
    entry?.write();
  }
  close() { for (const threadId of this.pending.keys()) this.flush(threadId); }
}

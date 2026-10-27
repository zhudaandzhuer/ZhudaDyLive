export interface DeliveryGap {
  expected: number;
  received: number;
  missed: number;
}

/** Snapshots are authoritative. Late subscribers establish a baseline without replay. */
export class DeliveryCursor<T extends { id: string; seq?: number }> {
  private epoch: string | null = null;
  private seen = new Set<string>();
  private last = 0;
  consume(epoch: string, events: T[], gap?: (gap: DeliveryGap) => void): T[] {
    const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.seen = new Set(ordered.map((event) => event.id));
      this.last = ordered.reduce((max, event) => Math.max(max, event.seq ?? 0), 0);
      return [];
    }
    const result: T[] = [];
    for (const event of ordered) {
      if (this.seen.has(event.id) || (event.seq !== undefined && event.seq <= this.last)) continue;
      if (event.seq !== undefined && event.seq > this.last + 1) {
        gap?.({ expected: this.last + 1, received: event.seq, missed: event.seq - this.last - 1 });
      }
      this.last = Math.max(this.last, event.seq ?? 0);
      this.seen.add(event.id);
      result.push(event);
    }
    if (this.seen.size > 1024) this.seen = new Set(ordered.map((event) => event.id));
    return result;
  }
}

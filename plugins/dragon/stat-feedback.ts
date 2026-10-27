type Counter = {
  from: number;
  target: number;
  started: number;
  duration: number;
  render: (value: number) => void;
};

/** Presentation only: authoritative values always come from the scene snapshot. */
export class StatFeedback {
  private counters = new Map<string, Counter>();
  private lanes = new Map<string, number>();

  constructor(
    private root: HTMLElement,
    private format: (value: number) => string,
  ) {}

  private value(counter: Counter, now: number) {
    const progress = Math.min(
      1,
      Math.max(0, (now - counter.started) / counter.duration),
    );
    return (
      counter.from + (counter.target - counter.from) * (1 - (1 - progress) ** 3)
    );
  }

  set(
    key: string,
    target: number,
    render: (value: number) => void,
    countUp = false,
  ) {
    const previous = this.counters.get(key);
    if (previous?.target === target) return;
    const now = performance.now();
    const from = previous && countUp ? this.value(previous, now) : target;
    const counter = { from, target, started: now, duration: 850, render };
    this.counters.set(key, counter);
    render(from);
  }

  gain(key: string, amount: number) {
    if (!(amount > 0)) return;
    const anchor = this.root.querySelector<HTMLElement>(`[data-stat="${key}"]`);
    if (!anchor) return;
    // Bound bursts while keeping each recent gift visible in a separate upward lane.
    const active = anchor.querySelectorAll(".stat-gain");
    if (active.length >= 3) active[0]!.remove();
    const token = document.createElement("span");
    token.className = "stat-gain";
    token.textContent = `+${this.format(amount)}`;
    token.dataset.amount = String(amount);
    token.setAttribute("aria-hidden", "true");
    const lane = this.lanes.get(key) ?? 0;
    this.lanes.set(key, (lane + 1) % 3);
    token.style.setProperty("--gain-drift", `${(lane - 1) * 1.6}cqw`);
    token.addEventListener("animationend", () => token.remove(), {
      once: true,
    });
    anchor.append(token);
  }

  tick(now: number) {
    for (const counter of this.counters.values()) {
      if (counter.from === counter.target) continue;
      const value = this.value(counter, now);
      counter.render(value);
      if (now >= counter.started + counter.duration) {
        counter.from = counter.target;
        counter.render(counter.target);
      }
    }
  }

  reset() {
    this.counters.clear();
    this.lanes.clear();
    this.root.querySelectorAll(".stat-gain").forEach((token) => token.remove());
  }
}

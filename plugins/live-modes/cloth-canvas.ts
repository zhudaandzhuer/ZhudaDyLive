import { clothPiece, clothChange, clothPileLayout } from "./cloth-layout";

type Change = ReturnType<typeof clothChange> & {
  start: number;
  duration: number;
  cursor: bigint;
};
const palettes: Record<string, string[][]> = {
  noir: [
    ["#bacbdd", "#486a94", "#233b66"],
    ["#efd2a2", "#987144", "#4b3529"],
    ["#aecdd2", "#487c86", "#203c4b"],
    ["#d4c2db", "#79618c", "#3a2d52"],
  ],
  chrome: [
    ["#effaff", "#6aaacb", "#275879"],
    ["#bccbff", "#687cbb", "#333c73"],
    ["#c4f9ee", "#579e9b", "#245d66"],
    ["#d4e0ee", "#7f94ae", "#40516f"],
  ],
  rose: [
    ["#fff1f8", "#e5a0be", "#a4507b"],
    ["#fff0d4", "#d6b180", "#967047"],
    ["#e7deff", "#aa91d2", "#745598"],
    ["#d7f8f0", "#8bc8ba", "#4c8e85"],
  ],
};

/** One sprite per point. Cached at rest; large totals yield between drawing chunks, never cap. */
export class ClothCanvas {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement("canvas");
  private baseCtx: CanvasRenderingContext2D;
  private sprites: HTMLCanvasElement[] = [];
  private theme = "";
  private count = 0n;
  private baseCount = 0n;
  private painted = 0n;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private size = "";
  private revision = 0;
  private frame = 0;
  private baseFrame = 0;
  private effect: Change | null = null;
  private disposed = false;
  private observer: ResizeObserver;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.baseCtx = this.base.getContext("2d")!;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  private resize() {
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const size = `${width}:${height}:${ratio}`;
    if (size === this.size) return;
    this.size = size;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = this.base.width = Math.round(width * ratio);
    this.canvas.height = this.base.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.baseCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paintBase(this.baseCount, true);
  }
  private textures(theme: string) {
    this.theme = theme;
    this.canvas.dataset.theme = theme;
    this.sprites = (palettes[theme] ?? palettes.noir!).map(
      ([light, mid, dark], variant) => {
        const sprite = document.createElement("canvas");
        sprite.width = 256;
        sprite.height = 96;
        const c = sprite.getContext("2d")!;
        const shape = new Path2D(
          "M19 29Q86 17 143 22Q187 15 219 23L239 42L237 68Q154 85 48 75Q28 69 19 51Z",
        );
        const g = c.createLinearGradient(0, 20, 8, 79);
        g.addColorStop(0, light!);
        g.addColorStop(0.36, mid!);
        g.addColorStop(0.5, light!);
        g.addColorStop(0.59, mid!);
        g.addColorStop(1, dark!);
        c.fillStyle = g;
        c.fill(shape);
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;
        c.save();
        c.clip(shape);
        c.lineWidth = 0.6;
        for (let x = 0; x < 256; x += 4) {
          c.strokeStyle = x % 8 ? "#ffffff13" : "#050a1622";
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x - 13, 96);
          c.stroke();
        }
        for (let y = 0; y < 96; y += 3) {
          c.strokeStyle = "#ffffff18";
          c.beginPath();
          c.moveTo(0, y);
          c.quadraticCurveTo(120, y - 5, 256, y + 3);
          c.stroke();
        }
        c.strokeStyle = variant % 2 ? "#fff4dd66" : "#e0faff66";
        c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.stroke(new Path2D("M27 32Q125 19 214 28L229 42Q136 59 48 49Z"));
        c.setLineDash([]);
        c.restore();
        // The rolled-under front edge and uneven creases read as folded fabric, not tiles.
        c.strokeStyle = dark!;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(22, 46);
        c.quadraticCurveTo(35, 61, 49, 59);
        c.quadraticCurveTo(138, 69, 236, 51);
        c.stroke();
        c.strokeStyle = light!;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(49, 61);
        c.quadraticCurveTo(144, 74, 233, 55);
        c.stroke();
        c.strokeStyle = dark!;
        c.globalAlpha = 0.35;
        c.beginPath();
        c.moveTo(79, 25);
        c.quadraticCurveTo(92, 34, 82, 49);
        c.moveTo(175, 23);
        c.quadraticCurveTo(160, 39, 183, 47);
        c.moveTo(51, 70);
        c.quadraticCurveTo(136, 81, 232, 64);
        c.stroke();
        return sprite;
      },
    );
  }
  update(
    count: bigint,
    theme: string,
    change?: { before: string; after: string; duration: number },
    settle = false,
  ) {
    if (this.disposed) return;
    const recolor = this.theme !== theme;
    const interrupted = settle && !!this.effect;
    if (recolor) this.textures(theme);
    this.canvas.dataset.targetCount = String(count);
    this.count = count;
    if (change && change.before !== change.after && !settle) {
      const range = clothChange(change.before, change.after);
      this.effect = {
        ...range,
        start: performance.now(),
        duration: Math.max(650, change.duration),
        cursor: range.from,
      };
      this.canvas.dataset.effect = range.kind;
      this.canvas.dataset.effectCount = String(range.count);
      this.paintBase(range.from, true);
      this.animate();
    } else if (settle || recolor || !this.effect) {
      this.effect = null;
      delete this.canvas.dataset.effect;
      this.canvas.dataset.effectCount = "0";
      this.paintBase(count, recolor || interrupted);
    }
  }
  private paintBase(count: bigint, force = false) {
    if (
      this.disposed ||
      (!force && this.baseCount === count && this.painted === count)
    )
      return;
    const append =
      !force && this.painted === this.baseCount && count >= this.baseCount;
    this.baseCount = count;
    const revision = ++this.revision;
    cancelAnimationFrame(this.baseFrame);
    if (!append) {
      this.baseCtx.clearRect(0, 0, this.width, this.height);
      this.painted = 0n;
    }
    if (!this.sprites.length) return;
    this.paintSupports(count);
    const paint = () => {
      if (this.disposed || revision !== this.revision) return;
      const start = performance.now();
      do {
        const end = this.painted + 64n < count ? this.painted + 64n : count;
        for (; this.painted < end; this.painted++)
          this.draw(this.baseCtx, this.painted);
      } while (this.painted < count && performance.now() - start < 6);
      this.canvas.dataset.renderedCount = String(this.painted);
      if (!this.effect) this.canvas.dataset.visibleCount = String(this.painted);
      this.present();
      if (this.painted < count) this.baseFrame = requestAnimationFrame(paint);
    };
    paint();
  }
  private paintSupports(count: bigint) {
    if (count === 0n) return;
    const c = this.baseCtx;
    const { tableY, size, right, left } = clothPileLayout(
      this.width,
      this.height,
    );
    c.save();
    c.globalCompositeOperation = "destination-over";
    for (const x of count > 48n ? [right, left] : [right]) {
      const l = x - size * 0.78,
        r = x + size * 0.78,
        y = tableY - size * 0.035,
        bottom = this.height * 0.985;
      const board = new Path2D(
        `M${l} ${y}Q${x} ${y + 4} ${r} ${y - 3}L${r - 4} ${y + 11}Q${x} ${y + 19} ${l + 3} ${y + 13}Z`,
      );
      const metal = c.createLinearGradient(0, y, 0, bottom);
      const light =
        this.theme === "rose"
          ? "#d7a8bf"
          : this.theme === "chrome"
            ? "#9cc1d7"
            : "#bba072";
      metal.addColorStop(0, light);
      metal.addColorStop(0.08, "#3a414e");
      metal.addColorStop(1, "#1b2635");
      c.fillStyle = metal;
      c.fill(board);
      c.strokeStyle = light;
      c.lineWidth = 1.5;
      c.stroke(board);
      c.fill(
        new Path2D(
          `M${l + 14} ${y + 10}L${l + 19} ${bottom}H${l + 30}L${l + 28} ${y + 10}ZM${r - 14} ${y + 10}L${r - 19} ${bottom}H${r - 30}L${r - 28} ${y + 10}Z`,
        ),
      );
      c.strokeStyle = "#677689";
      c.beginPath();
      c.moveTo(l + 25, bottom - 15);
      c.lineTo(r - 25, y + 27);
      c.moveTo(r - 25, bottom - 15);
      c.lineTo(l + 25, y + 27);
      c.stroke();
    }
    c.restore();
  }
  draw(
    c: CanvasRenderingContext2D,
    id: bigint,
    kind?: Change["kind"],
    progress = 1,
  ) {
    const p = clothPiece(id, this.width, this.height);
    let x = p.x,
      y = p.y,
      angle = p.angle,
      scale = 1;
    const t = Math.max(
      0,
      Math.min(
        1,
        kind === "sew" ? progress : (progress - p.delay) / (1 - p.delay),
      ),
    );
    if (kind === "supply") {
      const fall = 1 - (1 - t) ** 3;
      y =
        -(p.height + this.height * 0.18) +
        (p.y + p.height + this.height * 0.18) * fall;
      x +=
        Math.sin(t * Math.PI * 2 + Number(id % 7n)) * p.width * 0.6 * (1 - t);
      angle += (1 - t) * 1.8;
      scale = 0.8 + 0.2 * fall + Math.sin(t * Math.PI) * 0.2;
    } else if (kind === "sew") {
      if (t >= 1) return;
    }
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.scale(scale, scale);
    const sprite = this.sprites[p.variant]!;
    if (kind === "sew") {
      // Consume the top edge downward in place. Cloth never crosses the stage or flies into the needle.
      c.drawImage(
        sprite,
        0,
        sprite.height * t,
        sprite.width,
        sprite.height * (1 - t),
        -p.width / 2,
        -p.height / 2 + p.height * t,
        p.width,
        p.height * (1 - t),
      );
    } else c.drawImage(sprite, -p.width / 2, -p.height / 2, p.width, p.height);
    c.restore();
  }
  private present() {
    if (this.disposed) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(
      this.base,
      0,
      0,
      this.base.width,
      this.base.height,
      0,
      0,
      this.width,
      this.height,
    );
  }
  private animate = () => {
    cancelAnimationFrame(this.frame);
    const effect = this.effect;
    if (!effect || this.disposed) return;
    const progress = Math.min(
      1,
      (performance.now() - effect.start) / effect.duration,
    );
    if (progress >= 1) {
      this.effect = null;
      delete this.canvas.dataset.effect;
      this.canvas.dataset.effectCount = "0";
      this.canvas.dataset.visibleCount = String(this.count);
      this.paintBase(this.count);
      this.present();
      return;
    }
    this.present();
    // Remove sheets from the top of the stack, one after another, while the lower sheets stay still.
    // Keep the count arithmetic exact even when a plugin counter exceeds Number.MAX_SAFE_INTEGER.
    const consumed =
      effect.kind === "sew"
        ? effect.count * BigInt(Math.floor(progress * 1_000_000))
        : 0n;
    const boundary = effect.to - consumed / 1_000_000n - 1n;
    const limit = effect.kind === "sew" ? boundary + 1n : effect.to;
    const partial = Number(consumed % 1_000_000n) / 1_000_000;
    this.canvas.dataset.visibleCount = String(limit);
    const start = performance.now();
    let drawn = 0n;
    let id = effect.cursor < limit ? effect.cursor : effect.from;
    do {
      const end = id + 64n < limit ? id + 64n : limit;
      for (; id < end; id++) {
        this.draw(
          this.ctx,
          id,
          effect.kind === "sew" && id !== boundary ? undefined : effect.kind,
          effect.kind === "sew" ? partial : progress,
        );
        drawn++;
      }
    } while (id < limit && performance.now() - start < 8);
    effect.cursor = id === limit ? effect.from : id;
    this.canvas.dataset.drawnEffectCount = String(drawn);
    this.frame = requestAnimationFrame(this.animate);
  };
  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.baseFrame);
    this.revision++;
  }
}

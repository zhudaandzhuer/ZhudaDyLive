type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  thread: boolean;
};
export class LiveEffects {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private last = 0;
  private width = 1;
  private height = 1;
  private animation = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  private resize() {
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  burst(x: number, y: number, color: string, count = 75, thread = false) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2,
        speed = 55 + Math.random() * 240;
      const life = 0.5 + Math.random() * 1.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life,
        max: life,
        color,
        size: 1 + Math.random() * 3,
        thread,
      });
    }
    this.particles = this.particles.slice(-480);
    if (!this.animation) this.animation = requestAnimationFrame(this.draw);
  }
  private draw = (time: number) => {
    const dt = Math.min(0.04, (time - (this.last || time)) / 1000);
    this.last = time;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "lighter";
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 150 * dt;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      if (p.thread)
        ctx.quadraticCurveTo(
          p.x - p.vx * 0.05,
          p.y + 12,
          p.x - p.vx * 0.14,
          p.y - p.vy * 0.08,
        );
      else ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (this.particles.some((p) => p.life > 0))
      this.animation = requestAnimationFrame(this.draw);
    else {
      this.animation = 0;
      this.last = 0;
      ctx.clearRect(0, 0, this.width, this.height);
    }
  };
}

export class PrisonGate {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private openedAt = 0;
  private visible = true;
  private open = false;
  private animation = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => {
      this.resize();
      this.paint(performance.now());
    }).observe(canvas);
    this.resize();
  }
  private resize() {
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  update(visible: boolean, open: boolean, animate: boolean) {
    this.visible = visible;
    if (open !== this.open) {
      this.open = open;
      this.openedAt = animate && open ? performance.now() : 0;
    }
    this.paint(performance.now());
  }
  private paint = (time: number) => {
    cancelAnimationFrame(this.animation);
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.clearRect(0, 0, w, h);
    if (!this.visible) return;
    const t = this.open
      ? this.openedAt
        ? Math.min(1, (time - this.openedAt) / 1650)
        : 1
      : 0;
    const offset = (1 - (1 - t) ** 3) * (w / 2 + 28);
    const spacing = w / Math.max(6, Math.round(w / 115));
    const bar = Math.max(9, Math.min(22, w / 65));
    for (const side of [-1, 1]) {
      c.save();
      c.translate(side * offset, 0);
      c.beginPath();
      c.rect(side < 0 ? 0 : w / 2, 0, w / 2, h);
      c.clip();
      c.shadowColor = "#02070cb0";
      c.shadowBlur = 8;
      c.shadowOffsetX = 5;
      for (let x = 0; x <= w + spacing; x += spacing) {
        const g = c.createLinearGradient(x - bar / 2, 0, x + bar / 2, 0);
        for (const [at, color] of [
          [0, "#202831"],
          [0.2, "#7c8790"],
          [0.35, "#eff2ef"],
          [0.46, "#a0a8ae"],
          [0.7, "#404b57"],
          [1, "#161e28"],
        ] as const)
          g.addColorStop(at, color);
        c.fillStyle = g;
        c.fillRect(x - bar / 2, 0, bar, h);
        c.shadowBlur = 0;
        c.fillStyle = "#e2e9ef66";
        c.fillRect(x - bar / 2 + 3, 0, 1, h);
      }
      for (const y of [14, h * 0.34, h * 0.71, h - 24]) {
        const g = c.createLinearGradient(0, y, 0, y + 18);
        g.addColorStop(0, "#101923");
        g.addColorStop(0.2, "#cbd3d9");
        g.addColorStop(0.35, "#8c969f");
        g.addColorStop(1, "#26313b");
        c.fillStyle = g;
        c.fillRect(0, y, w, 18);
        for (let x = 0; x <= w; x += spacing) {
          c.beginPath();
          c.arc(x, y + 9, 3, 0, Math.PI * 2);
          c.fillStyle = "#19232d";
          c.fill();
          c.fillStyle = "#c1cbd4";
          c.fillRect(x - 1, y + 7, 2, 1);
        }
      }
      c.restore();
    }
    if (this.open && this.openedAt && t < 1)
      this.animation = requestAnimationFrame(this.paint);
  };
}

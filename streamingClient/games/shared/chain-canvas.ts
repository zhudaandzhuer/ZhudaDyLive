import { chainStrand, clipChainFace, type ChainStrand } from './chain-layout';
import { chainMaterials, type ChainTheme } from './chain-themes';

/** One draw per identity, cached while idle; never substitute a sample for the count. */
export class ChainCanvas {
  readonly context: CanvasRenderingContext2D;
  readonly ready: Promise<void>;
  width = 1;
  height = 1;
  ratio = 1;
  private textures: HTMLImageElement[] = [];
  private strip = document.createElement('canvas');
  private white = document.createElement('canvas');
  private molten = document.createElement('canvas');
  private shades: HTMLCanvasElement[] = [];
  private count = 0n;
  private revision = 0;
  private frame = 0;
  private loaded = false;
  private renderedSize = '';
  private strands = new Map<bigint, ChainStrand>();
  private disposed = false;
  private renderScale = 1;
  private resize: ResizeObserver;
  constructor(
    readonly canvas: HTMLCanvasElement,
    textureUrl = 'chain-steel.png',
    readonly theme: ChainTheme = 'classic',
  ) {
    this.context = canvas.getContext('2d', { alpha: true })!;
    this.canvas.dataset.theme = theme;
    const prefix = textureUrl.slice(0, textureUrl.lastIndexOf('/') + 1);
    this.textures = chainMaterials[theme].textures.map((name) => {
      const texture = new Image();
      texture.src = theme === 'classic' ? textureUrl : prefix + name;
      return texture;
    });
    this.ready = Promise.all(this.textures.map((texture) => texture.decode())).then(() => {
      if (this.disposed) return;
      this.loaded = true;
      this.measure();
    });
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(canvas);
    this.measure();
  }
  private measure() {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    // The iframe keeps scene coordinates (e.g. 1080 × 1920) even when its host
    // scales it down to a phone. Allocate actual displayed pixels, not a hidden
    // 2160 × 3840 surface. Full-size capture output retains its original density.
    const ratio = Math.max(0.125, Math.min((devicePixelRatio || 1) * this.renderScale, 2));
    const size = `${width}:${height}:${ratio}`;
    if (this.renderedSize === size) return;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    if (!this.loaded) return;
    this.renderedSize = size;
    this.strands.clear();
    const thickness = chainStrand(0n, width, height, this.theme).thickness;
    this.strip.width = Math.ceil((Math.hypot(width, height) + 48) * ratio);
    this.strip.height = Math.ceil(thickness * ratio);
    const material = chainMaterials[this.theme];
    const tile = thickness * material.aspect * ratio;
    const strips = this.textures.map((texture) => {
      const strip = document.createElement('canvas');
      strip.width = this.strip.width;
      strip.height = this.strip.height;
      const ctx = strip.getContext('2d')!;
      for (let x = 0; x < strip.width; x += tile) ctx.drawImage(texture, x, 0, tile, strip.height);
      return strip;
    });
    this.strip = strips[0]!;
    const copy = (
      target: HTMLCanvasElement,
      brightness?: number,
      color?: string,
      source = this.strip,
    ) => {
      target.width = this.strip.width;
      target.height = this.strip.height;
      const context = target.getContext('2d')!;
      if (brightness) context.filter = `brightness(${brightness})`;
      context.drawImage(source, 0, 0);
      context.filter = 'none';
      if (color) {
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = color;
        context.fillRect(0, 0, target.width, target.height);
        context.globalCompositeOperation = 'source-over';
      }
    };
    copy(this.white, undefined, material.flash);
    copy(this.molten, undefined, material.melt);
    this.shades = material.shades.map((brightness, index) => {
      const shade = document.createElement('canvas');
      copy(shade, brightness, undefined, strips[index % strips.length]);
      return shade;
    });
    this.setCount(this.count, true);
  }
  setRenderScale(scale = 1) {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.renderScale) return;
    this.renderScale = scale;
    this.measure();
  }
  setCount(count: bigint, force = false) {
    if (
      this.disposed ||
      (!force && this.count === count && this.canvas.dataset.targetCount === String(count))
    )
      return;
    this.count = count;
    this.canvas.dataset.targetCount = String(count);
    this.canvas.dataset.renderedCount = '0';
    const revision = ++this.revision;
    cancelAnimationFrame(this.frame);
    this.context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    if (!this.loaded) return;
    let id = 0n;
    const paint = () => {
      if (revision !== this.revision || this.disposed) return;
      this.context.save();
      clipChainFace(this.context, this.width, this.height);
      const start = performance.now();
      // Yield between chunks, including unusually large counters, without capping the count.
      do {
        const end = id + 128n < count ? id + 128n : count;
        for (; id < end; id++) this.draw(this.context, id);
      } while (id < count && performance.now() - start < 6);
      this.context.restore();
      this.canvas.dataset.renderedCount = String(id);
      if (id < count) this.frame = requestAnimationFrame(paint);
    };
    paint();
  }
  draw(ctx: CanvasRenderingContext2D, id: bigint, effect?: 'lock' | 'unlock', progress = 1) {
    const s = this.strand(id);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    const cut = s.length * s.cut;
    let sprite = this.shades[Number(id % BigInt(this.shades.length || 1))] ?? this.strip;
    let thin = 1;
    const part = (start: number, length: number, x: number) => {
      if (length <= 0) return;
      ctx.drawImage(
        sprite,
        start * this.ratio,
        0,
        length * this.ratio,
        this.strip.height,
        x,
        (-s.thickness * thin) / 2,
        length,
        s.thickness * thin,
      );
    };
    if (effect === 'unlock') {
      const p = progress;
      const melt = Math.max(0, (p - 0.24) / 0.76);
      const gap = Math.min(1, p / 0.12) * (s.thickness * 2 + 5);
      thin = Math.max(0.02, 1 - melt * 0.9);
      if (p > 0.07 && p < 0.24) sprite = this.white;
      else if (p >= 0.24) sprite = this.molten;
      ctx.globalAlpha = Math.max(0, 1 - melt ** 1.5);
      // The crack flashes, then the melt front consumes both halves from the
      // actual cut toward their anchors. No unrelated strand is affected.
      const left = Math.max(0, cut * (1 - melt) - gap);
      const right = Math.min(s.length, cut + (s.length - cut) * melt + gap);
      ctx.translate(0, melt * melt * 9);
      part(0, left, 0);
      part(right, s.length - right, right);
    } else if (effect === 'lock') {
      const incoming = Math.max(0, 1 - progress / 0.56) ** 3;
      const tension =
        progress > 0.56
          ? Math.sin(((progress - 0.56) / 0.44) * Math.PI * 3) * (1 - progress) * 12
          : 0;
      ctx.translate(0, tension);
      part(0, cut, -incoming * s.length);
      part(cut, s.length - cut, cut + incoming * s.length);
    } else part(0, s.length, 0);
    ctx.restore();
  }
  impact(id: bigint): ChainStrand & { impactX: number; impactY: number } {
    const s = this.strand(id);
    return {
      ...s,
      impactX: s.x + Math.cos(s.angle) * s.length * s.cut,
      impactY: s.y + Math.sin(s.angle) * s.length * s.cut,
    };
  }
  private strand(id: bigint) {
    const existing = this.strands.get(id);
    if (existing) return existing;
    const strand = chainStrand(id, this.width, this.height, this.theme);
    if (this.strands.size < 10000) this.strands.set(id, strand);
    return strand;
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.strands.clear();
  }
}

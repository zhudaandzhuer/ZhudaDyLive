export interface ChainStrand {
  x: number;
  y: number;
  length: number;
  angle: number;
  thickness: number;
  cut: number;
}
export interface ChainChange {
  kind: 'lock' | 'unlock';
  from: bigint;
  to: bigint;
  count: bigint;
}
export function chainChange(before: string, after: string): ChainChange {
  const a = BigInt(before),
    b = BigInt(after);
  return {
    kind: b > a ? 'lock' : 'unlock',
    from: a < b ? a : b,
    to: a > b ? a : b,
    count: a > b ? a - b : b - a,
  };
}
function random(id: bigint, salt: number) {
  let n = Number((id ^ (id >> 32n)) & 0xffffffffn) ^ salt;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/** The upper center stays clear in every orientation and material. */
export function chainFaceArea(width: number, height: number) {
  return { left: width * 0.16, right: width * 0.84, top: 0, bottom: height * 0.5 };
}
export function clipChainFace(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const face = chainFaceArea(width, height);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(face.left, face.top, face.right - face.left, face.bottom - face.top);
  ctx.clip('evenodd');
}
/** Stable identities wrap along the sides and cross below the face, never across it. */
export function chainStrand(
  id: bigint,
  width: number,
  height: number,
  theme: ChainTheme = 'classic',
): ChainStrand {
  const side = Number(id % 10n);
  let x: number, y: number, endX: number, endY: number;
  if (side < 2) {
    const a = width * (0.025 + random(id, 1741) * 0.07);
    const b = width * (0.025 + random(id, 7919) * 0.07);
    x = side === 0 ? a : width - a;
    endX = side === 0 ? b : width - b;
    y = -12;
    endY = height + 12;
  } else {
    const slope = ((random(id, 11617) - 0.5) * height * 1.5) / width;
    const center = height * (0.68 + random(id, 7919) * 0.25);
    // Lift the lowest crossing at the face's side boundary below the clear area.
    const lift = Math.max(0, height * 0.55 - (center - Math.abs(slope) * width * 0.34));
    x = -12;
    endX = width + 12;
    y = center + lift + slope * (x - width / 2);
    endY = center + lift + slope * (endX - width / 2);
    if (endY < y) {
      [x, endX] = [endX, x];
      [y, endY] = [endY, y];
    }
  }
  const length = Math.hypot(endX - x, endY - y);
  const angle = Math.atan2(endY - y, endX - x);
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  let cut = 0.25 + random(id, 3571) * 0.5;
  const outsideHud = (t: number) => {
    const px = x + dx * length * t,
      py = y + dy * length * t;
    return (
      px >= 2 &&
      px <= width - 2 &&
      py >= 12 &&
      py <= height - 12 &&
      (py < height - 130 || Math.abs(px - width / 2) > Math.min(174, width / 2 - 10))
    );
  };
  if (!outsideHud(cut))
    cut =
      [0.25, 0.75, 0.08, 0.92, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)].find(
        outsideHud,
      ) ?? cut;
  return {
    x,
    y,
    length,
    angle,
    thickness:
      theme === 'classic'
        ? Math.max(1.6, Math.min(4, Math.min(width, height) * 0.005))
        : Math.max(14, Math.min(42, Math.min(width, height) * (theme === 'plush' ? 0.058 : 0.052))),
    cut,
  };
}
import type { ChainTheme } from './chain-themes';

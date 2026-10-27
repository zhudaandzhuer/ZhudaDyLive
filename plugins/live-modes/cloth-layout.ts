export interface ClothPiece {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  variant: number;
  delay: number;
}

function random(id: bigint, salt: number) {
  let n = Number((id ^ (id >> 32n)) & 0xffffffffn) ^ salt;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function clothPileLayout(width: number, height: number) {
  const landscape = width >= height;
  // Match the responsive machine's table height, so the piles sit beside its bed.
  const machineWidth = Math.min(
    width * (landscape ? 0.58 : 0.94),
    landscape ? 720 : 850,
    height * 0.984375,
  );
  const tableY =
    height * (landscape ? 0.99 : 0.98) - (machineWidth * 150) / 900;
  const size = Math.min(180, Math.min(width, height) * 0.145);
  return {
    tableY,
    size,
    right: landscape ? width / 2 + machineWidth * 0.58 : width * 0.86,
    left: landscape ? width / 2 - machineWidth * 0.58 : width * 0.14,
  };
}

/** Stable folded layers: fill the input pile, then overflow to the opposite side. */
export function clothPiece(
  id: bigint,
  width: number,
  height: number,
): ClothPiece {
  const { tableY, size, right, left } = clothPileLayout(width, height);
  const block = id / 48n;
  const side = block % 2n === 0n ? 1 : -1;
  const local = (block / 2n) * 48n + (id % 48n);
  const column = Number(local % 3n) - 1;
  const layer = local / 3n;
  const thickness = size * 0.36;
  const maxRise = Math.max(thickness, tableY - height * 0.18);
  // Compress deep layers as the heap approaches the top; every identity still draws once.
  // Convert only a bounded layer ratio, keeping arbitrarily large point counts exact.
  const boundedLayer = Number(layer < 1000000n ? layer : 1000000n);
  const rise =
    maxRise * -Math.expm1((-boundedLayer * thickness * 0.62) / maxRise);
  const center = side > 0 ? right : left;
  const spread = size * 0.27 * (1 - (rise / maxRise) * 0.45);
  return {
    x: center + column * spread + (random(id, 713) - 0.5) * size * 0.08,
    y:
      tableY -
      thickness / 2 -
      rise +
      (random(id, 127) - 0.5) * thickness * 0.08,
    width: size * (0.92 + random(id, 91) * 0.12),
    height: thickness * (0.94 + random(id, 571) * 0.1),
    angle: (random(id, 811) - 0.5) * 0.1,
    variant: Math.floor(random(id, 1811) * 4),
    delay: random(id, 991) * 0.32,
  };
}

export function clothChange(before: string, after: string) {
  const a = BigInt(before),
    b = BigInt(after);
  return {
    kind: b > a ? ("supply" as const) : ("sew" as const),
    from: a < b ? a : b,
    to: a > b ? a : b,
    count: a > b ? a - b : b - a,
  };
}

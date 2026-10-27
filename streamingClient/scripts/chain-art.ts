// Offline geometry: swept steel tubes, alternating perpendicular link planes.
// The SVG is rasterized at build time and reused by each independent canvas strand.
type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return a.map((n) => n / length) as Vec;
};
const key = unit([-0.45, -0.7, 1]),
  rim = unit([0.7, 0.35, 0.65]);
const half = unit([key[0], key[1], key[2] + 1]);
const round = (n: number) => n.toFixed(2);

type Material = 'steel' | 'silver' | 'black' | 'plush';
function surface(t: number, v: number, x: number, angle: number, material: Material = 'steel') {
  const radius = 20,
    straight = 21,
    tube = material === 'plush' ? 9 : 6.8;
  const arc = Math.PI * radius,
    length = 2 * arc + 4 * straight;
  let distance = (((t % 1) + 1) % 1) * length;
  let cx: number, cy: number, nx: number, ny: number;
  if (distance < arc) {
    const a = -Math.PI / 2 + distance / radius;
    nx = Math.cos(a);
    ny = Math.sin(a);
    cx = straight + radius * nx;
    cy = radius * ny;
  } else if ((distance -= arc) < 2 * straight) {
    cx = straight - distance;
    cy = radius;
    nx = 0;
    ny = 1;
  } else if ((distance -= 2 * straight) < arc) {
    const a = Math.PI / 2 + distance / radius;
    nx = Math.cos(a);
    ny = Math.sin(a);
    cx = -straight + radius * nx;
    cy = radius * ny;
  } else {
    distance -= arc;
    cx = -straight + distance;
    cy = -radius;
    nx = 0;
    ny = -1;
  }
  const normal: Vec = [nx * Math.cos(v), ny * Math.cos(v), Math.sin(v)];
  const p: Vec = [cx + tube * normal[0] + x, cy + tube * normal[1], tube * normal[2]];
  const rotate = ([a, b, c]: Vec): Vec => [
    a,
    b * Math.cos(angle) - c * Math.sin(angle),
    b * Math.sin(angle) + c * Math.cos(angle),
  ];
  return { p: rotate(p), n: rotate(normal) };
}

function steel(normal: Vec, t: number, v: number, material: Material) {
  const n = unit(normal),
    reflection: Vec = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] ** 2 - 1];
  const strip = Math.exp(-(((reflection[1] + 0.48) / 0.17) ** 2));
  const edge = Math.exp(-(((reflection[0] - 0.7) / 0.11) ** 2)) * 0.35;
  const specular = Math.max(0, dot(n, half)) ** 45;
  if (material === 'plush') {
    const nap = Math.sin(t * 1513 + v * 97) * Math.sin(t * 2441 - v * 171) * 0.05;
    const soft = 0.72 + Math.max(0, dot(n, key)) * 0.24 + nap;
    return [255, 155, 202].map((c) => Math.round(Math.min(255, c * soft + 12 * Math.max(0, n[2]))));
  }
  const brush = Math.sin(t * 630 + v * 4) * Math.sin(t * 1190) * 0.013;
  const light =
    0.13 +
    0.32 * Math.max(0, dot(n, key)) +
    0.12 * Math.max(0, dot(n, rim)) +
    0.36 * strip +
    edge +
    0.55 * specular +
    brush;
  if (material === 'black') {
    const dark =
      0.055 + 0.12 * Math.max(0, dot(n, key)) + 0.19 * strip + edge * 0.5 + 0.3 * specular + brush;
    return [217, 227, 238].map((c) => Math.round(Math.min(255, c * dark)));
  }
  return [226, 235, 244].map((channel) =>
    Math.max(
      0,
      Math.min(255, Math.round(channel * (material === 'silver' ? light * 1.3 + 0.12 : light))),
    ),
  );
}

function mesh(centers: number[], width: number, single = false, material: Material = 'steel') {
  const polygons: { z: number; svg: string }[] = [];
  const along = 160,
    around = 28,
    height = 72;
  for (const center of centers) {
    const angle =
      ((single || Math.abs(Math.round(center / 64)) % 2 === 0 ? -24 : 66) * Math.PI) / 180;
    for (let i = 0; i < along; i++)
      for (let j = 0; j < around; j++) {
        const t = (i + 0.5) / along,
          v = ((j + 0.5) / around) * 2 * Math.PI;
        const middle = surface(t, v, center, angle, material);
        if (middle.n[2] < -0.05) continue;
        const points = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ].map(
          ([a, b]) => surface(a! / along, (b! / around) * 2 * Math.PI, center, angle, material).p,
        );
        if (points.every((p) => p[0] < -1) || points.every((p) => p[0] > width + 1)) continue;
        const color = `rgb(${steel(middle.n, t, v, material).join(',')})`;
        polygons.push({
          z: middle.p[2],
          svg: `<path d="M${points.map((p) => `${round(p[0])},${round(p[1] + height / 2)}`).join('L')}Z" fill="${color}" stroke="${color}" stroke-width=".24" stroke-linejoin="round"/>`,
        });
      }
  }
  polygons.sort((a, b) => a.z - b.z);
  let details = '';
  if (material === 'plush') {
    // Tiny sewn seams and surface fibres stay in the texture, with no live SVG work.
    for (const center of centers) {
      const angle = ((Math.abs(Math.round(center / 64)) % 2 === 0 ? -24 : 66) * Math.PI) / 180;
      for (let i = 0; i < 110; i++) {
        const t = i / 110,
          v = (i * 2.39996) % (Math.PI * 2);
        const { p, n } = surface(t, v, center, angle, material);
        if (n[2] < 0.2) continue;
        details += `<path d="M${round(p[0])},${round(p[1] + 36)}l${round(Math.sin(i * 71) * 1.1)},-1.2" fill="none" stroke="#ffe8f2" stroke-opacity=".5" stroke-width=".55" stroke-linecap="round"/>`;
      }
      const seam = Array.from(
        { length: 161 },
        (_, i) => surface(i / 160, Math.PI / 2, center, angle, material).p,
      );
      details += `<path d="M${seam.map((p) => `${round(p[0])},${round(p[1] + 36)}`).join('L')}" fill="none" stroke="#fff0f7" stroke-width=".8" stroke-dasharray="1.5 2.5" opacity=".7"/>`;
    }
    details += `<defs><radialGradient id="toy" cx="35%" cy="25%" r="80%"><stop stop-color="#fff6eb"/><stop offset=".65" stop-color="#f2c9bb"/><stop offset="1" stop-color="#c98e8f"/></radialGradient></defs>
      <g transform="translate(128 36)"><path d="M-6-3q-8-6-9 0q0 6 9 4m12-4q8-6 9 0q0 6-9 4" fill="#e6659f" stroke="#a84779" stroke-width=".8"/><circle cy="1" r="3" fill="#ffc5df"/></g>
      <g transform="translate(64 34)" stroke="#b67f80" stroke-width=".7"><circle cx="-9" cy="-8" r="5" fill="url(#toy)"/><circle cx="9" cy="-8" r="5" fill="url(#toy)"/><ellipse rx="12" ry="11" fill="url(#toy)"/><ellipse cy="4" rx="6" ry="4.5" fill="#fff1e4" stroke="none"/><g fill="#684454" stroke="none"><circle cx="-4.5" cy="-1.5" r="1.25"/><circle cx="4.5" cy="-1.5" r="1.25"/><ellipse cy="2.5" rx="1.7" ry="1.2"/></g><path d="M0 3.5v2m-2 0q2 2 4 0" fill="none"/><g fill="#ef9ab8" stroke="none"><ellipse cx="-8" cy="3" rx="2.3" ry="1.3"/><ellipse cx="8" cy="3" rx="2.3" ry="1.3"/></g></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${material} interlocking chain</title>${polygons.map((p) => p.svg).join('')}${details}</svg>`;
}

export function chainArtwork(): Record<string, string> {
  return {
    'chain-steel.svg': mesh([-64, 0, 64, 128, 192], 128),
    'link-steel.svg': mesh([50], 100, true),
    'chain-silver.svg': mesh([-64, 0, 64, 128, 192], 128, false, 'silver'),
    'chain-black.svg': mesh([-64, 0, 64, 128, 192], 128, false, 'black'),
    'chain-plush.svg': mesh([-64, 0, 64, 128, 192, 256, 320], 256, false, 'plush'),
  };
}

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './config';

// Light chain-link contacts and a separate hiss-only dissolve; no latch or rupture hit.
const rate = 48_000;
let seed = 0x7c3a91;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
function cue(seconds: number, breaking: boolean) {
  const left = new Float64Array(Math.round(seconds * rate));
  const right = new Float64Array(left.length);
  function collision(at: number, strength: number, decay: number, pan: number) {
    // Small solid links: short bright contacts without the low hollow can resonance.
    const frequencies = [2971, 4039, 5471, 7117, 9497, 12011].map(
      (f) => f * (0.96 + random() * 0.08),
    );
    const phases = frequencies.map(() => random() * Math.PI * 2);
    const start = Math.round(at * rate);
    let previous = 0,
      smoothed = 0;
    for (let i = 0; i < Math.min(left.length - start, decay * 8 * rate); i++) {
      const t = i / rate;
      const noise = random() * 2 - 1;
      const high = noise - previous;
      previous = noise;
      smoothed += (noise - smoothed) * 0.24;
      const attack = Math.min(1, t / 0.0004);
      const metal = frequencies.reduce(
        (sum, f, j) =>
          sum +
          (Math.sin(t * f * Math.PI * 2 + phases[j]!) * Math.exp(-t / (decay / (1 + j * 0.3)))) /
            (1 + j * 0.75),
        0,
      );
      const contact = high * Math.exp(-t / 0.0012) * 0.18;
      const friction = (noise - smoothed) * Math.exp(-t / 0.008) * 0.15;
      const value = strength * attack * (metal * 0.22 + contact + friction);
      left[start + i]! += value * Math.sqrt((1 - pan) / 2);
      right[start + i]! += value * Math.sqrt((1 + pan) / 2);
    }
  }
  if (breaking) {
    // Keep only the former dissolving texture: "嘶…", with no impact layer.
    let low = 0;
    for (let i = 0; i < left.length; i++) {
      const t = i / rate;
      const n = random() * 2 - 1;
      low += (n - low) * 0.2;
      const hiss = (n - low) * Math.min(1, t / 0.016) * Math.exp(-t / 0.16) * 0.12;
      left[i]! += hiss;
      right[i]! += hiss * 0.95;
    }
  } else {
    // A few light metal-on-metal contacts, with no final heavy locking hit.
    for (const [at, gain] of [
      [0.004, 0.8],
      [0.028, 0.33],
      [0.071, 0.58],
      [0.118, 0.27],
      [0.182, 0.41],
      [0.245, 0.15],
    ] as const)
      collision(at, gain, 0.014 + random() * 0.01, (random() - 0.5) * 0.35);
  }
  let peak = 0;
  for (let i = 0; i < left.length; i++)
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const targetPeak = breaking ? 0.3 : 0.65;
  const gain = targetPeak / peak;
  const wav = Buffer.alloc(44 + left.length * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(left.length * 4, 40);
  let energy = 0;
  for (let i = 0; i < left.length; i++) {
    const fade = Math.min(1, i / (rate * 0.001), (left.length - 1 - i) / (rate * 0.08));
    const l = left[i]! * gain * fade,
      r = right[i]! * gain * fade;
    energy += (l * l + r * r) / 2;
    wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return {
    wav,
    seconds,
    peak: targetPeak,
    rmsDb: 20 * Math.log10(Math.sqrt(energy / left.length)),
  };
}
const audio = [];
for (const [file, seconds, breaking] of [
  ['chain-bind.wav', 0.48, false],
  ['chain-fracture.wav', 0.7, true],
] as const) {
  const result = cue(seconds, breaking);
  writeFileSync(join(root, 'games/chain/audio', file), result.wav);
  audio.push({
    file,
    sha256: createHash('sha256').update(result.wav).digest('hex'),
    bytes: result.wav.length,
    sampleRate: rate,
    channels: 2,
    seconds,
    peak: result.peak,
    rmsDb: result.rmsDb,
  });
}
writeFileSync(
  join(root, 'games/chain/audio/source/provenance.json'),
  JSON.stringify(
    {
      method: 'Deterministic procedural metal foley synthesis',
      source: 'scripts/chain-foley.ts',
      description:
        'Bind: short bright metal-on-metal link contacts without a heavy latch hit or hollow low resonance. Dissolve: filtered friction hiss only, without rupture or loose-link impacts. No music, voices, recorded samples or SoundFont.',
      review_status: 'needs_listening',
      audio,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(root, 'games/chain/audio/sound-notices.json'),
  JSON.stringify(
    {
      title: '锁链拟音',
      method: '原创程序合成链环金属碰撞与纯消融声',
      source: 'scripts/chain-foley.ts',
      samples: '未使用外部采样或乐器音源',
      cues: { bind: '轻短金属链环碰撞', fracture: '嘶…（仅消融声）' },
    },
    null,
    2,
  ) + '\n',
);
console.log(audio);

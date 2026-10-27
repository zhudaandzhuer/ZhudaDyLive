import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginsRoot } from './config';

// Original mechanical/cloth foley, with no musical notes, voices or third-party samples.
const rate = 48_000;
const directory = join(pluginsRoot, 'live-modes/audio');
mkdirSync(directory, { recursive: true });
let seed = 0x5e71a9;
function noise() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 2147483648 - 1;
}
function make(cue: 'supply' | 'machine' | 'finish', seconds: number, target: number) {
  const samples = new Float64Array(Math.round(seconds * rate));
  let low = 0,
    mid = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate,
      n = noise();
    low += (n - low) * 0.018;
    mid += (n - mid) * 0.18;
    const rustle = mid - low;
    if (cue === 'supply') {
      const sweep = Math.sin(Math.PI * Math.min(1, t / 0.62)) ** 1.5;
      const folds = [0.07, 0.24, 0.43].reduce(
        (sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.038) : 0),
        0,
      );
      samples[i] = rustle * sweep * (0.22 + folds * 0.65) + low * folds * 0.7;
    } else if (cue === 'machine') {
      // Ten needle strokes per half second, with offset feed-dog contacts and a quiet motor.
      const phase = t % 0.05;
      const contact = Math.exp(-phase / 0.0018);
      const feed = phase >= 0.022 ? Math.exp(-(phase - 0.022) / 0.0035) : 0;
      const motor =
        Math.sin(2 * Math.PI * 106 * t) * 0.022 + Math.sin(2 * Math.PI * 212 * t) * 0.008;
      samples[i] =
        motor +
        rustle * 0.018 +
        contact * (n * 0.35 + Math.sin(2 * Math.PI * 1850 * phase) * 0.16) +
        feed * (rustle * 0.32 + Math.sin(2 * Math.PI * 630 * phase) * 0.1);
    } else {
      // Motor release, thread snip, then a short damped latch; no celebratory jingle.
      const brake = Math.sin(2 * Math.PI * (110 * t - 90 * t * t)) * Math.exp(-t / 0.065) * 0.07;
      const snip = t >= 0.12 ? Math.exp(-(t - 0.12) / 0.016) : 0;
      const latch = t >= 0.28 ? Math.exp(-(t - 0.28) / 0.035) : 0;
      samples[i] =
        brake +
        (n - mid) * snip * 0.3 +
        latch * (low * 0.4 + Math.sin(2 * Math.PI * 780 * (t - 0.28)) * 0.045);
    }
  }
  const peak = samples.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
  const wav = Buffer.alloc(44 + samples.length * 4);
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
  wav.writeUInt32LE(samples.length * 4, 40);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / (rate * 0.003), (samples.length - 1 - i) / (rate * 0.025));
    const sample = ((samples[i]! * target) / peak) * fade;
    energy += sample * sample;
    // Almost centered: the effect must remain audible in mono livestream capture.
    wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(sample * 0.98 * 32767), 46 + i * 4);
  }
  const file = `sewing-${cue}.wav`;
  writeFileSync(join(directory, file), wav);
  return {
    file,
    seconds,
    bytes: wav.length,
    sampleRate: rate,
    channels: 2,
    sha256: createHash('sha256').update(wav).digest('hex'),
    peak: target,
    rmsDb: 20 * Math.log10(Math.sqrt(energy / samples.length)),
  };
}
const audio = [make('supply', 0.72, 0.5), make('machine', 0.54, 0.6), make('finish', 0.65, 0.5)];
writeFileSync(
  join(directory, 'sound-notices.json'),
  JSON.stringify(
    {
      title: '缝纫机拟音',
      method: '原创程序合成布料摩擦、机针与电机、收线剪线声',
      source: 'scripts/sewing-foley.ts',
      samples: '未使用外部采样、音乐或人声',
      cues: { supply: '布料入库摩擦', machine: '机针与送料机构运转', finish: '停机收线剪线' },
      audio,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(audio, null, 2));

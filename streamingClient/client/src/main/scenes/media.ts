import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
const mime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};
export class SceneMedia {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  import(path: string, type: 'image' | 'video') {
    const ext = extname(path).slice(1).toLowerCase(),
      stat = statSync(path);
    if (
      !mime[ext]?.startsWith(type + '/') ||
      !stat.isFile() ||
      stat.size > (type === 'image' ? 10_000_000 : 100_000_000)
    )
      throw new Error('素材格式或大小不支持（图片 10 MB／视频 100 MB）');
    const bytes = readFileSync(path);
    return this.saveBytes(bytes, ext);
  }
  cacheImage(bytes: Buffer) {
    if (bytes.length > 1_000_000) throw new Error('礼物图标过大');
    const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'jpg'
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
          ? 'gif'
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP'
            ? 'webp'
            : '';
    if (!ext) throw new Error('礼物图标格式不支持');
    return this.saveBytes(bytes, ext);
  }
  private saveBytes(bytes: Buffer, ext: string) {
    // Check the selected file's container instead of trusting its extension.
    const valid =
      ext === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : ['jpg', 'jpeg'].includes(ext)
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : ext === 'gif'
            ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
            : ext === 'webp'
              ? bytes.subarray(0, 4).toString() === 'RIFF' &&
                bytes.subarray(8, 12).toString() === 'WEBP'
              : ext === 'mp4'
                ? bytes.subarray(4, 8).toString() === 'ftyp'
                : bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
    if (!valid) throw new Error('文件内容与素材格式不符');
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    writeFileSync(join(this.root, name), bytes, { mode: 0o600 });
    return `zhuda-scene://media/${name}`;
  }
  exportAsset(name: string) {
    if (!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(name))
      throw new Error('素材地址无效');
    const bytes = readFileSync(join(this.root, name));
    if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0])
      throw new Error('素材已损坏');
    return bytes;
  }
  importAsset(name: string, bytes: Buffer) {
    if (
      !/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(name) ||
      createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0]
    )
      throw new Error('素材校验失败');
    const ext = name.split('.')[1]!;
    if (bytes.length > (mime[ext]?.startsWith('image/') ? 10_000_000 : 100_000_000))
      throw new Error('素材大小超出限制');
    return this.saveBytes(bytes, ext);
  }
  serve(request: Request) {
    try {
      const url = new URL(request.url),
        name = url.pathname.slice(1);
      if (
        url.hostname !== 'media' ||
        url.search ||
        !/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(name)
      )
        throw new Error();
      const bytes = readFileSync(join(this.root, name));
      if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0])
        throw new Error();
      const headers = {
        'Content-Type': mime[name.split('.')[1]!]!,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]),
          end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        if (start > end || start >= bytes.length)
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${bytes.length}` },
          });
        return new Response(bytes.subarray(start, end + 1), {
          status: 206,
          headers: {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
            'Content-Length': String(end - start + 1),
          },
        });
      }
      return new Response(bytes, {
        headers: { ...headers, 'Content-Length': String(bytes.length) },
      });
    } catch {
      return new Response('Media unavailable', { status: 404 });
    }
  }
}

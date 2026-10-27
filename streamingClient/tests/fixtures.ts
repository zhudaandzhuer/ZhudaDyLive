import { generateKeyPairSync } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { manifestSchema, type CatalogItem } from '@zhuda/contracts';
import { protocolRoot, sha256, signValue } from '@zhuda/core';
const pair = generateKeyPairSync('ed25519');
export const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const manifest = manifestSchema.parse({
  schemaVersion: 1,
  apiVersion: 1,
  id: 'game.chain',
  version: '0.1.0',
  name: '解锁',
  description: 'fixture',
  category: 'game',
  entry: 'index.html',
  initial: '4000',
  accent: '#d8f68b',
  files: {},
  rules: [
    { giftId: '2001', giftName: '玫瑰', delta: -10 },
    { giftId: '685', giftName: '心心', delta: 100 },
  ],
});
export const encode = (type: string, data: Record<string, unknown>) => {
  const t = protocolRoot.lookupType(type);
  return t.encode(t.fromObject(data)).finish();
};
export function gift(repeat: number, options: Record<string, unknown> = {}) {
  return encode('GiftMessage', {
    common: { msgId: '9223372036854775901', roomId: '9223372036854775902' },
    giftId: '2001',
    groupCount: '1',
    repeatCount: String(repeat),
    comboCount: String(repeat),
    user: { id: '9223372036854775903', nickname: '测试观众' },
    toUser: { id: '9223372036854775904' },
    groupId: '9001',
    gift: { id: '2001', name: '玫瑰', combo: true },
    repeatEnd: 0,
    ...options,
  });
}
export function pack(
  files: Record<string, Uint8Array> = { 'index.html': strToU8('<h1>play</h1>') },
  override: Record<string, unknown> = {},
) {
  const zip = zipSync(files),
    info = manifestSchema.parse({
      ...manifest,
      files: Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [
          name,
          { sha256: sha256(bytes), bytes: bytes.length },
        ]),
      ),
    });
  const descriptor = { manifest: info, sha256: sha256(zip), bytes: zip.length, ...override };
  const item: CatalogItem = {
    ...descriptor,
    signature: signValue(descriptor, privateKey),
    downloadPath: '/api/v1/packages/game.chain/0.1.0',
  };
  return { zip, item };
}

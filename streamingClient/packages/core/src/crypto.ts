import { createHash, sign, verify, timingSafeEqual } from 'node:crypto';
import type { SignedValue } from '@zhuda/contracts';

export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export function signValue(value: unknown, privateKey: string): SignedValue {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') };
}
export function verifyValue(value: SignedValue, publicKey: string): unknown {
  if (
    !value ||
    typeof value.payload !== 'string' ||
    typeof value.signature !== 'string' ||
    value.payload.length > 1_000_000 ||
    value.signature.length > 200
  )
    throw new Error('签章格式错误');
  if (
    !verify(null, Buffer.from(value.payload), publicKey, Buffer.from(value.signature, 'base64url'))
  )
    throw new Error('官方签章验证失败');
  return JSON.parse(Buffer.from(value.payload, 'base64url').toString('utf8')) as unknown;
}
export function constantEqual(a: string, b: string): boolean {
  const left = Buffer.from(sha256(a)),
    right = Buffer.from(sha256(b));
  return timingSafeEqual(left, right);
}

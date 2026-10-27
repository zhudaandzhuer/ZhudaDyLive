import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

export const root = resolve(
  process.env.LIVE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'),
);
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
export const local = join(root, '.local');
export const pluginsRoot = resolve(root, '..', 'plugins');
export const production = process.env.NODE_ENV === 'production';
export function authority() {
  const privatePath =
    process.env.LIVE_PRIVATE_KEY_FILE || join(local, 'keys/development-private.pem');
  const publicPath = process.env.LIVE_PUBLIC_KEY_FILE || join(local, 'keys/development-public.pem');
  if (production && (!process.env.LIVE_PRIVATE_KEY_FILE || !process.env.LIVE_PUBLIC_KEY_FILE))
    throw new Error('正式环境须指定 LIVE_PRIVATE_KEY_FILE 与 LIVE_PUBLIC_KEY_FILE');
  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    if (production || process.env.LIVE_PRIVATE_KEY_FILE || process.env.LIVE_PUBLIC_KEY_FILE)
      throw new Error('指定的签章密钥不存在');
    mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
    writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), {
      mode: 0o644,
    });
  }
  const privateKey = readFileSync(privatePath, 'utf8'),
    publicKey = readFileSync(publicPath, 'utf8');
  if (
    createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !==
    createPublicKey(publicKey).export({ type: 'spki', format: 'pem' })
  )
    throw new Error('公私钥不匹配');
  return { privateKey, publicKey };
}
export function paths() {
  return {
    packageDir: resolve(process.env.LIVE_PACKAGE_DIR || join(local, 'packages')),
  };
}

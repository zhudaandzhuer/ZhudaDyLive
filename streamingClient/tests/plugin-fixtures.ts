import { zipSync, strToU8 } from 'fflate';
import { signPluginUpload } from '@zhuda/core';
import { privateKey } from './fixtures';
export function pluginPack(
  override: Record<string, unknown> = {},
  files: Record<string, Uint8Array> = {},
) {
  const manifest = {
    kind: 'plugin',
    apiVersion: 1,
    id: 'plugin.notes',
    version: '1.0.0',
    minAppVersion: '0.1.0',
    name: '备忘测试',
    description: '可安装的测试插件',
    publisher: '猪大官方',
    category: 'productivity',
    entry: 'index.html',
    permissions: ['storage'],
    ...override,
  };
  const zip = zipSync({
    'plugin.json': strToU8(JSON.stringify(manifest)),
    'index.html': strToU8('<h1>插件</h1>'),
    ...files,
  });
  return { zip, item: signPluginUpload(zip, privateKey) };
}

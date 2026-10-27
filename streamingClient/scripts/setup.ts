import { mkdirSync } from 'node:fs';
import { authority, paths } from './config';
authority();
for (const path of Object.values(paths())) mkdirSync(path, { recursive: true, mode: 0o700 });
console.log('开发环境已准备完成，私钥与本机数据保存在忽略版控的 .local。');

import type { PluginManifest } from '@zhuda/contracts';

/** Declarative, bounded transformations. Plugins never execute code in the host. */
export function migratePluginData(
  data: Record<string, unknown>,
  from: number,
  manifest: PluginManifest,
) {
  const target = manifest.dataVersion ?? 1;
  if (target < from) throw new Error('插件数据版本不能自动降级，请使用回退功能');
  const result = structuredClone(data);
  while (from < target) {
    const migration = manifest.dataMigrations?.find((m) => m.from === from && m.to <= target);
    if (!migration) throw new Error('插件缺少数据迁移声明，已保留原版本与数据');
    for (const op of migration.operations) {
      if (op.operation === 'remove') delete result[op.key];
      else if (op.operation === 'default') {
        if (!Object.hasOwn(result, op.key))
          Object.defineProperty(result, op.key, {
            value: structuredClone(op.value),
            enumerable: true,
            configurable: true,
            writable: true,
          });
      } else if (Object.hasOwn(result, op.key)) {
        if (Object.hasOwn(result, op.to) && op.to !== op.key)
          throw new Error('插件数据迁移存在键名冲突');
        if (op.to !== op.key) {
          Object.defineProperty(result, op.to, {
            value: result[op.key],
            enumerable: true,
            configurable: true,
            writable: true,
          });
          delete result[op.key];
        }
      }
    }
    from = migration.to;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
    throw new Error('迁移后的插件数据超过大小限制');
  return result;
}

import type { SceneRuntime, SceneSource, SceneLayer, GameEventDefinition } from '@zhuda/contracts';

export function elapsedSeconds(runtime: SceneRuntime, now = Date.now()) {
  return (
    ((runtime.elapsedMs ?? 0) +
      (runtime.status === 'running'
        ? Math.max(0, Math.min(now, runtime.completedAt ?? now) - Date.parse(runtime.startedAt))
        : 0)) /
    1000
  );
}
export function initialVariables(source: SceneSource, layer: SceneLayer) {
  return Object.fromEntries(
    (source.variables ?? []).map((v) => [
      v.key,
      v.parameter ? Number(layer.settings[v.parameter] ?? v.initial) : v.initial,
    ]),
  );
}
export function visibleVariables(source: SceneSource, runtime: SceneRuntime, now = Date.now()) {
  const elapsed = elapsedSeconds(runtime, now);
  return Object.fromEntries(
    (source.variables ?? []).map((v) => [
      v.key,
      Math.max(0, (runtime.variables?.[v.key] ?? v.initial) - (v.clock ? elapsed : 0)),
    ]),
  );
}
export function mutateValue(before: number, operation: string, amount: number, quantity: number) {
  if (operation === 'multiply' && (before === 0 || amount === 0)) return 0;
  const value =
    operation === 'set'
      ? amount
      : operation === 'multiply'
        ? before * amount ** Math.min(quantity, 64)
        : before + amount * quantity * (operation === 'subtract' ? -1 : 1);
  // Multiplication is bounded before conversion/storage, including huge gift combos.
  return Math.max(0, Math.min(1_000_000_000, Number.isFinite(value) ? value : 1_000_000_000));
}
export function mutateCounter(before: bigint, operation: string, amount: number, quantity: string) {
  if (operation === 'set') return BigInt(amount);
  const limit = 9999999999999999999999999999999999999999n;
  if (operation === 'multiply') {
    let value = before,
      remaining = BigInt(quantity),
      factor = BigInt(amount);
    while (remaining > 0n) {
      if (remaining % 2n) value = value * factor > limit ? limit : value * factor;
      remaining /= 2n;
      if (remaining) factor = factor * factor > limit ? limit : factor * factor;
    }
    return value;
  }
  const after = before + BigInt(amount) * BigInt(quantity) * (operation === 'subtract' ? -1n : 1n);
  return after < 0n ? 0n : after;
}
export function applyVariable(
  source: SceneSource,
  runtime: SceneRuntime,
  event: GameEventDefinition,
  amount: number,
  quantity: number,
  now = Date.now(),
) {
  const mutation = event.mutation;
  if (!mutation || mutation.target === 'remaining') return;
  const variable = source.variables?.find((v) => v.key === mutation.target);
  if (!variable) throw new Error('动作变量不存在');
  const current = visibleVariables(source, runtime, now)[variable.key] ?? 0;
  (runtime.variables ??= {})[variable.key] =
    mutateValue(current, mutation.operation, mutation.value ?? amount, quantity) +
    (variable.clock ? elapsedSeconds(runtime, now) : 0);
}

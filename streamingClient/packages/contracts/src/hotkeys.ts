import { z } from 'zod';

const modifiers = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Super'] as const;
const keys = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
]);
export function normalizeHotkey(value: string): string {
  const parts = value.split('+').map((p) => p.trim());
  const key = parts.pop()!;
  if (
    !keys.has(key) ||
    new Set(parts).size !== parts.length ||
    parts.some((p) => !modifiers.includes(p as (typeof modifiers)[number])) ||
    (parts.includes('CommandOrControl') && (parts.includes('Control') || parts.includes('Super')))
  )
    throw new Error('请选择字母、数字、功能键或有效组合键');
  return [...modifiers.filter((p) => parts.includes(p)), key].join('+');
}
export function hotkeyFromKeyEvent(
  event: {
    key: string;
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  platform: string,
): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit\d$/.test(event.code)
      ? event.code.slice(5)
      : event.code === 'Space'
        ? 'Space'
        : event.key.startsWith('Arrow')
          ? event.key.slice(5)
          : event.key;
  const modifiers = [
    ...(event.metaKey ? [platform === 'darwin' ? 'CommandOrControl' : 'Super'] : []),
    ...(event.ctrlKey ? ['Control'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
  ];
  return normalizeHotkey([...modifiers, key].join('+'));
}
export function platformHotkey(value: string, platform: string): string {
  return normalizeHotkey(value)
    .replace('CommandOrControl', platform === 'darwin' ? 'Super' : 'Control')
    .split('+')
    .sort()
    .join('+');
}
export function displayHotkey(value: string, platform: string): string {
  return value
    .replace('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Super', platform === 'darwin' ? '⌘' : 'Win');
}
export const sceneHotkeySchema = z
  .object({
    id: z.string().uuid(),
    accelerator: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          return normalizeHotkey(v) === v;
        } catch {
          return false;
        }
      }, '热键组合无效'),
    eventId: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,47}$/),
    amount: z.number().int().positive().max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();
export const sceneHotkeysSchema = z
  .array(sceneHotkeySchema)
  .max(32)
  .refine((v) => new Set(v.map((h) => h.id)).size === v.length, '热键编号不可重复');
export type SceneHotkey = z.infer<typeof sceneHotkeySchema>;
export const globalHotkeySchema = z
  .object({
    id: z.string().uuid(),
    accelerator: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          return normalizeHotkey(v) === v;
        } catch {
          return false;
        }
      }, '热键组合无效'),
    giftId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    quantity: z.number().int().positive().max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();
export const globalHotkeysSchema = z
  .array(globalHotkeySchema)
  .max(32)
  .refine((v) => new Set(v.map((h) => h.id)).size === v.length, '热键编号不可重复');
export type GlobalHotkey = z.infer<typeof globalHotkeySchema>;
export interface SceneHotkeyStatus {
  layerId: string;
  hotkeyId: string;
  scope?: 'layer' | 'global';
  state: 'active' | 'waiting' | 'disabled' | 'conflict' | 'error' | 'suspended';
  message: string;
  lastTriggeredAt?: string;
  lastResult?: string;
}

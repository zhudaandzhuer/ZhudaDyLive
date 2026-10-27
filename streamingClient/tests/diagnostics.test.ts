import { expect, it } from 'vitest';
import type { StudioSnapshot } from '@zhuda/contracts';
import { diagnosticReport } from '../client/src/main/diagnostics';
it('诊断采用字段白名单，不导出用户内容和登录凭据', () => {
  const report = diagnosticReport({
    appVersion: '0.3.0',
    platform: 'win32',
    deviceId: 'secret-device',
    collector: {
      state: 'stopped',
      parseErrors: 2,
      webId: 'secret-room',
      message: 'secret-message',
    },
    gifts: [{ senderName: 'secret-user' }],
    scene: undefined,
    plugins: undefined,
  } as unknown as StudioSnapshot);
  const text = JSON.stringify(report);
  expect(report.collector.parseErrors).toBe(2);
  expect(text).not.toContain('secret');
});

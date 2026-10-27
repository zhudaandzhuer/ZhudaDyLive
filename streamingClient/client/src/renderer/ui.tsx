import React from 'react';

type IconName =
  | 'plugin'
  | 'game'
  | 'image'
  | 'text'
  | 'color'
  | 'grid'
  | 'live'
  | 'key'
  | 'settings'
  | 'arrow'
  | 'play'
  | 'download'
  | 'screen'
  | 'stop'
  | 'refresh'
  | 'copy'
  | 'link'
  | 'check'
  | 'grip'
  | 'trash'
  | 'close';
const paths: Record<IconName, string> = {
  game: 'M7 7h10a4 4 0 0 1 4 3l1 7a2 2 0 0 1-3.4 1.7L16 16H8l-2.6 2.7A2 2 0 0 1 2 17l1-7a4 4 0 0 1 4-3ZM7 10v4m-2-2h4m7-1h.01m3 3h.01',
  image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M16 7h.01',
  text: 'M4 5h16M12 5v15m-4 0h8',
  color: 'M4 4h16v16H4zM4 16 16 4',
  plugin: 'M8 3h4a3 3 0 1 1 6 0h3v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H3v-6a3 3 0 1 0 0-6V3h5Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  live: 'M3 12h3l3-7 6 14 3-7h3',
  key: 'M14 6a5 5 0 1 1-3 9L3 23v-5l7-7a5 5 0 0 1 4-5ZM17 9h.01',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  arrow: 'M5 19 19 5M5 5h14v14',
  play: 'm8 5 11 7-11 7z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  screen: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  stop: 'M6 6h12v12H6z',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  copy: 'M8 8h11v13H8zM5 16H3V3h13v2',
  link: 'm9 15 6-6M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  check: 'm5 12 4 4L19 6',
  grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  close: 'm6 6 12 12M6 18 18 6',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export const date = (value: string | number) =>
  new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export const number = (value: string | number) => {
  try {
    return BigInt(value).toLocaleString('en-US');
  } catch {
    return '—';
  }
};
export const collectorLabels = {
  idle: '尚未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重新连接中',
  error: '连接异常',
  stopped: '已停止',
};

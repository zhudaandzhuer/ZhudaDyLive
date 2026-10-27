import React from 'react';
import type { SceneSource } from '@zhuda/contracts';
import { Icon } from './ui';

export function SceneSourceIcon({
  source,
  size = 22,
}: {
  source: SceneSource | null;
  size?: number;
}) {
  const interactive =
    source?.runtime === 'interactive' || !!source?.events.length || !!source?.observations?.length;
  const name = interactive
    ? 'game'
    : source?.id === 'text'
      ? 'text'
      : source?.id === 'image'
        ? 'image'
        : source?.id === 'video'
          ? 'play'
          : source?.id === 'color'
            ? 'color'
            : 'plugin';
  return (
    <span className="source-icon" data-source-icon={name}>
      <Icon name={name} size={size} />
    </span>
  );
}

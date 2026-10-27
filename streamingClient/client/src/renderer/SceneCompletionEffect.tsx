import React, { useEffect, useRef, useState } from 'react';
import type { SceneLayerView } from '@zhuda/contracts';
import { layerViewport } from './layer-sizing';
import { CompletionPlayback, type CompletionPresentation } from './completion-playback';

function Fireworks({ presentation }: { presentation: CompletionPresentation }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(presentation);
  current.current = presentation;
  useEffect(() => {
    const node = canvas.current!;
    const ctx = node.getContext('2d')!;
    let animation = 0;
    const resize = () => {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      node.width = Math.round(node.clientWidth * ratio);
      node.height = Math.round(node.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    const paint = () => {
      const { at, deadline, color } = current.current;
      const now = Date.now(),
        time = (now - at) / 1000;
      const w = node.clientWidth,
        h = node.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (now >= deadline) return;
      const scale = Math.min(w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let burst = 0; burst < 7; burst++) {
        const age = time - burst * 0.42;
        if (age < 0 || age > 1.7) continue;
        const x = w * [0.23, 0.76, 0.5, 0.14, 0.87, 0.33, 0.69][burst]!;
        const y = h * [0.33, 0.29, 0.2, 0.52, 0.48, 0.68, 0.63][burst]!;
        const fade = Math.min(1, (deadline - now) / 450) * (1 - age / 1.7) ** 1.6;
        for (let i = 0; i < 64; i++) {
          const angle = (i / 64) * Math.PI * 2 + burst;
          const speed = scale * (0.13 + ((i * 17 + burst * 11) % 23) / 160);
          const radius = speed * (1 - Math.exp(-age * 2.3));
          const tail = Math.max(0, age - 0.055);
          const oldRadius = speed * (1 - Math.exp(-tail * 2.3));
          ctx.globalAlpha = fade;
          ctx.strokeStyle = i % 5 === 0 ? '#fff4c5' : color;
          ctx.lineWidth = Math.max(1, scale / 500) * (i % 3 === 0 ? 2 : 1);
          ctx.beginPath();
          ctx.moveTo(
            x + Math.cos(angle) * oldRadius,
            y + Math.sin(angle) * oldRadius + tail * tail * scale * 0.06,
          );
          ctx.lineTo(
            x + Math.cos(angle) * radius,
            y + Math.sin(angle) * radius + age * age * scale * 0.06,
          );
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      animation = requestAnimationFrame(paint);
    };
    animation = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      ctx.clearRect(0, 0, node.width, node.height);
    };
  }, [presentation.id]);
  return <canvas ref={canvas} className="scene-completion-fireworks" aria-hidden="true" />;
}

export function SceneCompletionEffect({ view }: { view: SceneLayerView }) {
  const playback = useRef(new CompletionPlayback());
  const origin = useRef({ id: '', delay: 0 });
  const [, tick] = useState(0);
  const now = Date.now();
  const presentation = playback.current.sample(view, now);
  if (presentation && origin.current.id !== presentation.id)
    origin.current = { id: presentation.id, delay: now - presentation.at };
  useEffect(() => {
    if (!presentation) return;
    const timer = setTimeout(
      () => tick((v) => v + 1),
      Math.max(0, presentation.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [presentation?.id, presentation?.deadline]);
  if (!presentation) return null;
  const viewport = layerViewport(view.layer);
  return (
    <div
      key={presentation.id}
      className="scene-completion-effect"
      role="status"
      data-completion-id={presentation.id}
      style={
        {
          width: viewport.width,
          height: viewport.height,
          transform: `scale(${viewport.scale})`,
          transformOrigin: 'top left',
          '--completion-color': presentation.color,
          '--completion-duration': `${presentation.deadline - presentation.at}ms`,
          '--completion-delay': `${-origin.current.delay}ms`,
        } as React.CSSProperties
      }
    >
      {presentation.fireworks && <Fireworks presentation={presentation} />}
      <strong className="scene-completion-text">{presentation.text}</strong>
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { SceneCommand, SceneDocument } from '@zhuda/contracts';

type DropTarget = { id: string; placement: 'above' | 'below' };

export function useLayerListDrag(
  document: Pick<SceneDocument, 'id' | 'revision'> | undefined,
  busy: boolean,
  onCommand: (command: SceneCommand) => Promise<boolean>,
) {
  const list = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const drag = useRef<{
    id: string;
    sceneId: string;
    revision: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    element: HTMLButtonElement;
    pointerId: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  function targetAt(x: number, y: number): DropTarget | null {
    if (!list.current) return null;
    const bounds = list.current.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const rows = [...list.current.querySelectorAll<HTMLElement>('.scene-layer-row')];
    const row = rows.find((row) => y < row.getBoundingClientRect().bottom) ?? rows.at(-1);
    if (!row || row.dataset.layerId === drag.current?.id) return null;
    const rect = row.getBoundingClientRect();
    return {
      id: row.dataset.layerId!,
      placement: y < rect.top + rect.height / 2 ? 'above' : 'below',
    };
  }

  function cancel() {
    const current = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setDraggingId(null);
    setDropTarget(null);
  }

  useEffect(() => {
    cancel();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [document?.id]);

  function tick() {
    const current = drag.current;
    if (!current?.active || !list.current) return;
    const bounds = list.current.getBoundingClientRect();
    if (
      current.x >= bounds.left &&
      current.x <= bounds.right &&
      current.y >= bounds.top &&
      current.y <= bounds.bottom
    ) {
      if (current.y < bounds.top + 28) list.current.scrollTop -= 8;
      if (current.y > bounds.bottom - 28) list.current.scrollTop += 8;
    }
    const target = targetAt(current.x, current.y);
    setDropTarget((previous) =>
      previous?.id === target?.id && previous?.placement === target?.placement ? previous : target,
    );
    frame.current = requestAnimationFrame(tick);
  }

  function start(id: string, event: PointerEvent<HTMLButtonElement>) {
    if (!document || busy || event.button !== 0 || drag.current) return false;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id,
      sceneId: document.id,
      revision: document.revision,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      element: event.currentTarget,
      pointerId: event.pointerId,
    };
    return true;
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (
      !current.active &&
      Math.hypot(current.x - current.startX, current.y - current.startY) >= 5
    ) {
      current.active = true;
      setDraggingId(current.id);
      tick();
    }
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const target = targetAt(event.clientX, event.clientY);
    cancel();
    if (!current.active || !target || busy) return;
    void onCommand({
      action: 'reorder',
      id: current.id,
      sceneId: current.sceneId,
      revision: current.revision,
      targetId: target.id,
      placement: target.placement,
    });
  }

  return { list, draggingId, dropTarget, start, move, finish, cancel };
}

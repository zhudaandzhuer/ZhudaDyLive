import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

type TourTab = 'scene' | 'live' | 'plugins';
const steps: { id: string; tab: TourTab; target: string; title: string; text: string }[] = [
  {
    id: 'scene',
    tab: 'scene',
    target: '.scene-canvas-bar',
    title: '这里是你的直播场景',
    text: '直版、横版或自订尺寸，都从同一个场景开始。画面会自动保存，下次打开可以继续搭建。',
  },
  {
    id: 'sources',
    tab: 'scene',
    target: '[data-tour="add-source"]',
    title: '从插件加入场景来源',
    text: '锁链玩法、文字、图片和视频都能加入场景。同一个插件可以放入多个独立图层，更多来源可从本机插件区添加。',
  },
  {
    id: 'layers',
    tab: 'scene',
    target: '[data-tour="layers"]',
    title: '排列图层，组合画面',
    text: '在场景搭建中拖曳移动、拖动右下角调整大小。列表上方会覆盖下方；隐藏只关闭画面，锁定可避免误拖。',
  },
  {
    id: 'parameters',
    tab: 'scene',
    target: '[data-tour="inspector"]',
    title: '每个图层都有自己的设置',
    text: '选择图层后，可调整主题、尺寸和礼物映射。场景测试中的全局事件会让所有已加入的玩法一起响应；连接抖音后会自动接收真实直播事件。',
  },
  {
    id: 'plugins',
    tab: 'plugins',
    target: '#tab-plugins',
    title: '左侧随时切换插件区',
    text: '安装、更新或打开插件管理。右侧场景始终保留，搭建、测试和媒体播放不会因为切换左侧分区而中断。',
  },
  {
    id: 'output',
    tab: 'scene',
    target: '[data-tour="scene-preview"]',
    title: '测试完整场景',
    text: '场景测试可查看干净画面并测试交互。需要直播伴侣截取时，点击「打开输出窗口」；可在工作台点击「关闭输出窗口」，或在独立窗口按 Esc 关闭。绿幕色键设为 #00FF00。',
  },
  {
    id: 'observe',
    tab: 'live',
    target: '#metric-gifts',
    title: '直播观测只看数据',
    text: '点击状态、消息、礼物或异常，查看对应明细。玩法与素材的控制都留在场景搭建。',
  },
];
type Rect = { left: number; top: number; width: number; height: number };

export function GuidedTour({
  dismissed,
  onNavigate,
  onFinish,
}: {
  dismissed: boolean;
  onNavigate: (tab: TourTab) => void;
  onFinish: (dismissed: boolean) => Promise<boolean>;
}) {
  const [index, setIndex] = useState(-1);
  const [remember, setRemember] = useState(dismissed === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<{ rect: Rect | null; width: number; height: number }>({
    rect: null,
    width: innerWidth,
    height: innerHeight,
  });
  const [cardHeight, setCardHeight] = useState(350);
  const card = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const step = steps[index];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.app-shell')!;
    const wasInert = shell.inert;
    shell.inert = true;
    return () => {
      shell.inert = wasInert;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    card.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(() => {
      if (card.current) setCardHeight(card.current.getBoundingClientRect().height);
    });
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, [index]);
  useLayoutEffect(() => {
    setFrame({ rect: null, width: innerWidth, height: innerHeight });
    if (!step) {
      const resize = () => setFrame({ rect: null, width: innerWidth, height: innerHeight });
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    onNavigate(step.tab);
    let target: HTMLElement | null = null,
      animation = 0,
      attempts = 0;
    const measure = () => {
      const bounds = target?.getBoundingClientRect();
      let rect: Rect | null = null;
      if (bounds && bounds.width && bounds.height) {
        const left = Math.max(8, bounds.left - 6),
          top = Math.max(8, bounds.top - 6);
        rect = {
          left,
          top,
          width: Math.max(0, Math.min(innerWidth - 8, bounds.right + 6) - left),
          height: Math.max(0, Math.min(innerHeight - 8, bounds.bottom + 6) - top),
        };
      }
      setFrame({ rect, width: innerWidth, height: innerHeight });
    };
    const observer = new ResizeObserver(measure);
    const locate = () => {
      // The selected tab renders in the next React commit. Prefer the first
      // available target in the declared fallback order, not document order.
      target =
        step.target
          .split(',')
          .map((selector) => document.querySelector<HTMLElement>(selector.trim()))
          .find((element) => element && element.getBoundingClientRect().height > 0) ?? null;
      if (!target && attempts++ < 30) {
        animation = requestAnimationFrame(locate);
        return;
      }
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (target) observer.observe(target);
      measure();
    };
    animation = requestAnimationFrame(locate);
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [step, onNavigate]);

  async function finish() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (!(await onFinish(remember))) setError('偏好尚未保存，请再试一次。');
    } catch {
      setError('偏好尚未保存，请再试一次。');
    } finally {
      setSaving(false);
    }
  }
  function next() {
    if (saving) return;
    if (index === steps.length - 1) void finish();
    else setIndex(index + 1);
  }
  const { rect, width, height } = frame;
  const cardWidth = Math.min(step ? 370 : 440, width - 32);
  let left = (width - cardWidth) / 2,
    top = (height - cardHeight) / 2;
  if (step && rect) {
    const gap = 22,
      right = rect.left + rect.width,
      bottom = rect.top + rect.height;
    if (width - right >= cardWidth + gap + 16) {
      left = right + gap;
      top = rect.top + (rect.height - cardHeight) / 2;
    } else if (rect.left >= cardWidth + gap + 16) {
      left = rect.left - cardWidth - gap;
      top = rect.top + (rect.height - cardHeight) / 2;
    } else {
      left = rect.left + (rect.width - cardWidth) / 2;
      top = height - bottom >= cardHeight + gap + 16 ? bottom + gap : rect.top - cardHeight - gap;
    }
  }
  left = Math.max(16, Math.min(width - cardWidth - 16, left));
  top = Math.max(16, Math.min(height - cardHeight - 16, top));
  const mask =
    `M0 0H${width}V${height}H0Z` +
    (step && rect ? `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h-${rect.width}Z` : '');
  return createPortal(
    <div
      className="guided-tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
      data-tour-stage={step?.id ?? 'welcome'}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          void finish();
        }
        if (event.key === 'Tab') {
          const controls = [
            ...root.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled)',
            ),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === card.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <svg className="tour-mask" width={width} height={height} aria-hidden="true">
        <path d={mask} fill="rgba(0, 0, 0, .82)" fillRule="evenodd" />
      </svg>
      {step && rect && (
        <button
          className="tour-spotlight"
          type="button"
          style={rect}
          onClick={next}
          disabled={saving}
          aria-label={`亮起区域：${step.title}，${index === steps.length - 1 ? '完成教学' : '下一步'}`}
        />
      )}
      <section
        className={`tour-card${step ? '' : ' tour-welcome'}`}
        style={{ left, top, width: cardWidth }}
        ref={card}
        tabIndex={-1}
      >
        <button
          className="icon-button tour-close"
          aria-label="跳过新手教学"
          onClick={() => void finish()}
          disabled={saving}
        >
          <Icon name="close" size={18} />
        </button>
        <span className="eyebrow">
          {step
            ? `快速上手 · ${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`
            : '欢迎使用猪大直播'}
        </span>
        {!step && (
          <div className="tour-welcome-icon">
            <Icon name="live" size={28} />
          </div>
        )}
        <h2 id="tour-title">{step?.title ?? '一起认识你的直播工作台'}</h2>
        <p id="tour-text">
          {step?.text ?? '跟着亮起的位置，认识场景搭建、插件来源与直播连接，组合出你的直播画面。'}
        </p>
        {step && (
          <p className="tour-hint">
            {index === steps.length - 1
              ? '点击亮起区域，或按完成教学结束。'
              : '点击亮起区域，或按下一步继续。'}
          </p>
        )}
        {step && (
          <div className="tour-progress" aria-label={`第 ${index + 1} 步，共 ${steps.length} 步`}>
            {steps.map((item, i) => (
              <span key={item.id} className={i <= index ? 'complete' : ''} />
            ))}
          </div>
        )}
        <label className="tour-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            disabled={saving}
          />
          以后不再显示
        </label>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <footer className="tour-actions">
          <button
            className="text-button"
            type="button"
            onClick={() => void finish()}
            disabled={saving}
          >
            跳过教学
          </button>
          <div>
            {step && (
              <button
                className="button secondary"
                type="button"
                onClick={() => setIndex(index - 1)}
                disabled={saving}
              >
                上一步
              </button>
            )}
            <button
              className="button"
              type="button"
              onClick={next}
              disabled={saving || (!!step && !rect)}
            >
              {saving
                ? '保存中⋯'
                : !step
                  ? '开始教学'
                  : index === steps.length - 1
                    ? '完成教学'
                    : '下一步'}
              <Icon name={index === steps.length - 1 ? 'check' : 'arrow'} size={13} />
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

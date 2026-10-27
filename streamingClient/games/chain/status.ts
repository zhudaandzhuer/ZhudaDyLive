import { scene } from '../../packages/plugin-sdk/src/index';
import { ActionCursor } from '../shared/actions';
const el = (id: string) => document.getElementById(id)!;
const cursor = new ActionCursor();
let roundId: string | undefined;
let message = '';
let messageUntil = 0;
let idleText = '每一份礼物，都有戏。';
let timer: ReturnType<typeof setTimeout> | undefined;
const resetNotice = () => {
  message = '';
  messageUntil = 0;
  el('notice').textContent = idleText;
};
const unsubscribe = scene.subscribe((state) => {
  const { round } = state.game;
  idleText = String(state.settings.idleText ?? '每一份礼物，都有戏。');
  if (roundId !== round?.id) {
    roundId = round?.id;
    clearTimeout(timer);
    resetNotice();
  }
  el('title').textContent = String(state.settings.title ?? '解锁挑战');
  el('label').textContent = String(state.settings.counterLabel ?? '剩余锁链');
  document.body.style.setProperty('--text', String(state.settings.textColor ?? '#ffffff'));
  document.body.style.setProperty(
    '--background-opacity',
    String(Number(state.settings.backgroundOpacity ?? 90) / 100),
  );
  el('notice').hidden = state.settings.showNotice === false;
  el('progress').parentElement!.hidden = state.settings.showProgress === false;
  el('mode').textContent = !round
    ? '尚未启动'
    : state.status === 'paused'
      ? '已暂停'
      : state.status === 'stopped'
        ? '已停止'
        : round.status === 'won'
          ? '等待新礼物'
          : state.mode === 'demo'
            ? '试玩模式'
            : '直播挑战';
  el('remaining').textContent = round ? BigInt(round.remaining).toLocaleString('en-US') : '—';
  el('remaining').style.setProperty('--digits', String(el('remaining').textContent!.length));
  const ratio = round ? (BigInt(round.remaining) * 100n) / BigInt(round.initial) : 0n;
  const progress = Number(ratio > 100n ? 100n : ratio < 0n ? 0n : ratio);
  el('progress').style.width = `${progress}%`;
  el('progress').parentElement!.setAttribute('aria-valuenow', String(progress));
  const fresh = cursor.consume(state.game);
  if (fresh.length) {
    const action = fresh.at(-1)!;
    const delta = BigInt(action.delta);
    message = `${action.senderName} · ${action.eventName ?? '锁链变化'} ${delta > 0n ? '+' : ''}${delta.toLocaleString('en-US')}`;
    messageUntil = Date.now() + 3200;
    clearTimeout(timer);
    timer = setTimeout(resetNotice, 3200);
  }
  el('notice').textContent = message && Date.now() < messageUntil ? message : idleText;
});
window.addEventListener(
  'pagehide',
  () => {
    unsubscribe();
    clearTimeout(timer);
  },
  { once: true },
);

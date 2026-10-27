import type { GameState } from '@zhuda/contracts';
import { scene } from '../../packages/plugin-sdk/src/index';
import { ActionCursor } from './actions';
import { ChainEffects } from './chain-effects';
import { ChainAudio } from './chain-audio';
const number = document.querySelector<HTMLElement>('#remaining')!;
const mode = document.querySelector<HTMLElement>('#mode')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const stage = document.querySelector<HTMLElement>('.stage')!;
const bar = document.querySelector<HTMLElement>('#progress')!;
const prank = document.body.dataset.game === 'prank';
const cursor = new ActionCursor();
const sound = prank ? null : new ChainAudio();
let roundId: string | null = null,
  timer: ReturnType<typeof setTimeout> | undefined;
function message(text: string) {
  notice.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => {
    notice.textContent = '每一份礼物，都有戏。';
  }, 3200);
}
const effects = prank
  ? null
  : new ChainEffects(
      stage,
      (batch) => {
        message(
          `${batch.action.senderName} · ${batch.action.giftName} × ${batch.action.quantity}${batch.count > 1 ? ` · 合并 ${batch.count} 次交互` : ''}`,
        );
      },
      (kind) => sound?.play(kind),
    );
function update(state: GameState) {
  document.body.dataset.background = state.background;
  const round = state.round;
  document.body.dataset.theme = round?.theme ?? 'default';
  effects?.setTheme(round?.theme);
  if (roundId !== (round?.id ?? null)) {
    sound?.stop();
    effects?.reset();
    clearTimeout(timer);
    stage.classList.remove('impact', 'reversal', 'glitch');
    notice.textContent = '每一份礼物，都有戏。';
    roundId = round?.id ?? null;
  }
  const fresh = cursor.consume(state);
  if (!round) {
    number.textContent = '准备中';
    effects?.update('0', []);
    return;
  }
  number.textContent = BigInt(round.remaining).toLocaleString('en-US');
  number.style.setProperty('--digits', String(number.textContent.length));
  mode.textContent =
    round.status === 'won'
      ? '等待新礼物'
      : round.status === 'stopped'
        ? '回合结束'
        : round.mode === 'demo'
          ? '试玩模式'
          : '直播挑战';
  const wasWon = stage.classList.contains('won');
  stage.classList.toggle('won', round.status === 'won');
  if (wasWon && round.status !== 'won') notice.textContent = '每一份礼物，都有戏。';
  const percent = (BigInt(round.remaining) * 100n) / BigInt(round.initial);
  bar.style.width = `${percent > 100n ? 100n : percent < 0n ? 0n : percent}%`;
  if (effects) effects.update(round.remaining, fresh);
  else if (fresh.length) {
    const action = fresh.at(-1)!;
    message(
      `${action.senderName} 触发了${action.eventName ?? (BigInt(action.delta) < 0n ? '舞台震动' : '反转加码')}！`,
    );
    const effect =
      action.eventId === 'glitch' ? 'glitch' : action.eventId === 'reverse' ? 'reversal' : 'impact';
    stage.classList.remove('impact', 'reversal', 'glitch');
    stage.style.setProperty('--effect-strength', String(Math.min(10, Number(action.value ?? 3))));
    void stage.offsetWidth;
    stage.classList.add(effect);
  }
}
if (window.zhudaGame) {
  sound?.configure(true);
  let received = false;
  const unsubscribe = window.zhudaGame.subscribe((state) => {
    received = true;
    update(state);
  });
  void window.zhudaGame.snapshot().then((state) => {
    if (!received) update(state);
  });
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribe();
      clearTimeout(timer);
      effects?.dispose();
      sound?.dispose();
    },
    { once: true },
  );
} else {
  const unsubscribe = scene.subscribe((state) => {
    effects?.setRenderScale(state.renderScale);
    effects?.configure(state.settings);
    sound?.configure(
      state.audio?.enabled !== false &&
        state.status === 'running' &&
        state.settings.soundEnabled !== false,
      Number(state.settings.soundVolume ?? 60),
      state.audio?.transport === 'host',
    );
    update(state.game);
    document.body.dataset.sceneStatus = state.status;
    if (state.status === 'paused') mode.textContent = '已暂停';
  });
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribe();
      clearTimeout(timer);
      effects?.dispose();
      sound?.dispose();
    },
    { once: true },
  );
}

export function gameHtml(game: string, name: string, detachedHud = false) {
  const prank = game === 'prank';
  const counter = `<div class="counter"><i class="rivet tl"></i><i class="rivet tr"></i><i class="rivet bl"></i><i class="rivet br"></i><small>${prank ? '舞台能量' : '剩余锁链'}</small><strong id="remaining">—</strong><div class="delta" id="delta" aria-live="off"></div></div>`;
  const progress = '<div class="track"><div id="progress"></div></div>';
  const notice = '<div class="notice" id="notice">每一份礼物，都有戏。</div>';
  const mode = '<div class="mode" id="mode">正在准备</div>';
  const content = prank
    ? `<div class="brand">猪大直播</div>${mode}<div class="prank-badge">✦</div>${counter}${progress}${notice}<div class="foot">让直播充满惊喜</div>`
    : `<canvas class="chain-rig" aria-hidden="true"></canvas><canvas class="chain-motion" aria-hidden="true"></canvas><div id="effects" aria-hidden="true"></div><section class="chain-hud"${detachedHud ? ' hidden' : ''} aria-label="解锁挑战计数"><div class="hud-heading"><span>解锁挑战</span>${mode}</div>${counter}${progress}${notice}</section>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="style.css"><script src="game.js" defer></script></head><body data-game="${game}"><div class="drag"></div><main class="stage">${content}</main></body></html>`;
}

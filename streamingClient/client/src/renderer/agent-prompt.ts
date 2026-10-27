export const AGENT_DEVELOPMENT_PROMPT = `你正在为“猪大直播”开发一个插件或互动小游戏。

开始前请先阅读项目根目录的 README.md、README/AGENT.md、README/PLUGIN.md 和 README/GAME.md，并遵守其中的目录、权限、事件与安全约束。

开发要求：
- 插件必须放进本机插件区，以 ZIP 形式被工作台扫描；声明唯一的 plugin.id、版本号、入口文件和最小权限。
- 玩法通过工作站提供的统一礼物、消息、点赞、关注和热键事件运行，不自行登录抖音、不读取 Cookie、不抓包、不依赖远程服务。
- 场景来源要支持横版、竖版、窄屏和手机预览；默认画面简洁，重要内容不要遮挡直播主脸部。
- 使用 SVG 或 Canvas 制作动画，事件状态由工作站驱动；完成特效必须能被下一次事件中断并正确清理。
- 先运行 npm run typecheck、npm test 和 npm run check，再把可安装 ZIP 放入插件区验证。

请先检查现有插件和 contracts 的事件接口，复用已有模式；完成后说明改动文件、事件映射、权限和验证结果。`;

export async function copyAgentDevelopmentPrompt() {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(AGENT_DEVELOPMENT_PROMPT);
      return;
    } catch {
      // Fall back to the legacy command for restricted Electron contexts.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = AGENT_DEVELOPMENT_PROMPT;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('clipboard unavailable');
  } finally {
    textarea.remove();
  }
}

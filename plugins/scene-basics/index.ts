import { scene } from "../../streamingClient/packages/plugin-sdk/src/index";
const type = document.body.dataset.source!;
const root = document.getElementById("source")!;
const element = document.createElement(
  type === "image" ? "img" : type === "video" ? "video" : "div",
);
root.append(element);
let currentUrl = "";
let previousPlayback = "";
scene.subscribe((state) => {
  const settings = state.settings;
  if (type === "instructions") {
    renderInstructions(state);
  } else if (type === "text") {
    element.textContent = String(settings.text ?? "");
    Object.assign(element.style, {
      color: settings.color,
      fontSize: `${settings.fontSize}px`,
      fontWeight: settings.bold ? "800" : "400",
      textAlign: settings.align,
    });
  } else if (type === "color")
    element.style.background = String(settings.color);
  else {
    const url = String(settings.file ?? "");
    if (url !== currentUrl) {
      currentUrl = url;
      if (url) element.setAttribute("src", url);
      else element.removeAttribute("src");
    }
    element.style.objectFit = String(settings.fit ?? "contain");
    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.loop = settings.loop === true;
      element.playsInline = true;
      const playback = JSON.stringify([
        state.playbackRevision,
        url,
        settings.loop,
      ]);
      // Resize, visibility and audio notifications must not restart or seek the video.
      if (state.playbackRevision !== undefined && playback === previousPlayback)
        return;
      previousPlayback = playback;
      const syncTime = () => {
        if (element.duration > 0 && Number.isFinite(element.duration)) {
          const at = element.loop
            ? state.playbackTime % element.duration
            : Math.min(state.playbackTime, element.duration);
          if (Math.abs(element.currentTime - at) > 0.15)
            element.currentTime = at;
        }
      };
      if (element.readyState >= 1) syncTime();
      else element.onloadedmetadata = syncTime;
      if (state.status === "running" && url)
        void element.play().catch(() => {});
      else {
        element.pause();
        if (state.status === "stopped") element.currentTime = 0;
      }
    }
  }
});

let previousInstructions = "";
function renderInstructions(
  state: import("../../streamingClient/packages/contracts/src/scenes").SceneFrameState,
) {
  const signature = JSON.stringify([state.instructions, state.settings]);
  if (signature === previousInstructions) return;
  previousInstructions = signature;
  const settings = state.settings;
  element.className = "instructions";
  element.setAttribute("data-layout", String(settings.layout ?? "horizontal"));
  element.setAttribute("data-panel", String(settings.panel ?? true));
  element.style.setProperty("--text", String(settings.color ?? "#ffffff"));
  element.style.setProperty("--accent", String(settings.accent ?? "#d8f68b"));
  element.style.fontSize = `${Number(settings.fontSize ?? 28)}px`;
  element.replaceChildren();
  if (!state.instructions) return;
  if (settings.title) {
    const title = document.createElement("h2");
    title.textContent = String(settings.title);
    element.append(title);
  }
  const list = document.createElement("div");
  list.className = "instruction-list";
  for (const mapping of state.instructions.mappings) {
    const row = document.createElement("div");
    row.className = "instruction-row";
    row.dataset.giftId = mapping.giftId;
    const icon = document.createElement("span");
    icon.className = "gift-icon";
    icon.textContent = "🎁";
    if (mapping.icon) {
      const img = document.createElement("img");
      img.alt = mapping.giftName;
      img.src = mapping.icon;
      img.onload = fitInstructions;
      img.onerror = () => {
        img.remove();
        icon.textContent = "🎁";
        fitInstructions();
      };
      icon.replaceChildren(img);
    }
    const text = document.createElement("div");
    const gift = document.createElement("strong");
    gift.textContent = mapping.giftName;
    const action = document.createElement("span");
    action.textContent = `${mapping.label} ${mapping.amount}${mapping.unit}`;
    text.append(gift, action);
    row.append(icon, text);
    list.append(row);
  }
  if (!state.instructions.mappings.length) {
    const empty = document.createElement("p");
    empty.textContent = "尚未设置礼物事件";
    list.append(empty);
  }
  element.append(list);
  fitInstructions();
}
function fitInstructions() {
  // Offscreen editor iframes can suspend RAF even when the output is running.
  // Measure after rendering so all mappings fit before either view becomes visible.
  const scale = Math.min(1, innerHeight / Math.max(1, element.scrollHeight));
  element.style.transform = `scale(${scale})`;
}
if (type === "instructions") {
  new ResizeObserver(fitInstructions).observe(root);
  void document.fonts.ready.then(fitInstructions);
}

import type { SceneFrameState } from "../../../streamingClient/packages/contracts/src/index";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("game");
let latest: SceneFrameState | null = null;
const send = () => {
  if (latest)
    frame.contentWindow?.postMessage(
      { channel: "zhuda-scene-state", state: latest },
      "*",
    );
};
window.addEventListener("message", (event) => {
  if (
    event.source === frame.contentWindow &&
    event.data?.channel === "zhuda-scene-ready"
  )
    send();
});
frame.addEventListener("load", send);
const stream = new EventSource("/api/events");
stream.onmessage = (event) => {
  latest = JSON.parse(event.data) as SceneFrameState;
  send();
  const finished = latest.battle?.phase === "finished";
  $("status").textContent =
    latest.status === "paused" ? "已暂停" : finished ? "本场结束" : "自动交战";
  $("match").textContent = `第 ${latest.battle?.round ?? 1} 次交锋`;
  $("pause").textContent = latest.status === "paused" ? "继续" : "暂停";
  $<HTMLButtonElement>("pause").disabled = finished;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-event]",
  ))
    button.disabled = latest.status !== "running" || finished;
};
stream.onerror = () => {
  $("status").textContent = "连接中断，正在重连";
};
async function post(path: string, data: unknown) {
  const response = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败");
}
async function act(callback: () => Promise<void>) {
  try {
    await callback();
  } catch (error) {
    $("feedback").textContent = (error as Error).message;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-event]",
))
  button.onclick = () =>
    void act(async () => {
      const quantity = Number($<HTMLInputElement>("quantity").value);
      await post("gift", { eventId: button.dataset.event, quantity });
      $("feedback").textContent =
        `${button.dataset.event!.startsWith("hero") ? "猪大" : "恶龙"}：${button.textContent} ×${quantity} 已生效`;
    });
$("pause").onclick = () =>
  void act(() =>
    post("control", {
      action: latest?.status === "paused" ? "resume" : "pause",
    }),
  );
$("reset").onclick = () =>
  void act(() =>
    post("control", {
      action: "reset",
      prepSeconds: Number($<HTMLSelectElement>("interval").value),
    }),
  );
$("clean").onclick = () => document.body.classList.toggle("clean");
window.onkeydown = (event) => {
  if (event.key === "Escape") document.body.classList.remove("clean");
};

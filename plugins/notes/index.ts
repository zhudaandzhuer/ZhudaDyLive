import { studioPlugin } from "../../streamingClient/packages/plugin-sdk/src/index";
const note = document.querySelector<HTMLTextAreaElement>("#note")!,
  save = document.querySelector<HTMLButtonElement>("#save")!,
  status = document.querySelector<HTMLElement>("#status")!;
async function start() {
  const stored = await studioPlugin.storage.get<string>("note");
  note.value = typeof stored === "string" ? stored : "";
  note.disabled = false;
  save.disabled = false;
  status.textContent = "备忘只保存在这台电脑。";
}
note.addEventListener("input", () => {
  status.textContent = "有尚未保存的修改";
});
save.addEventListener("click", async () => {
  save.disabled = true;
  const value = note.value;
  try {
    await studioPlugin.storage.set("note", value);
    status.textContent = note.value === value ? "已保存" : "有尚未保存的修改";
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "保存失败，请重试";
  } finally {
    save.disabled = false;
  }
});
void start().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "无法加载备忘";
});

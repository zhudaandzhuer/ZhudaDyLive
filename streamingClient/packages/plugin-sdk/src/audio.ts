/** Use when state.audio.transport is 'host'; files are relative to this plugin's entry. */
export const sceneAudio = {
  play(file: string, volume = 1) {
    window.parent.postMessage({ channel: 'zhuda-scene-audio', action: 'play', file, volume }, '*');
  },
  stop() {
    window.parent.postMessage({ channel: 'zhuda-scene-audio', action: 'stop' }, '*');
  },
};

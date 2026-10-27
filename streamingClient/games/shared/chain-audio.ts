import { sceneAudio } from '../../packages/plugin-sdk/src/audio';

type Cue = 'lock' | 'unlock';

/** Bounded one-shot voices; counts in a gift never become thousands of simultaneous sounds. */
export class ChainAudio {
  private enabled = false;
  private volume = 0.6;
  private hosted = false;
  private voices: HTMLAudioElement[] = [];
  configure(enabled: boolean, volume = 60, hosted = false) {
    if (this.hosted !== hosted) this.stop();
    this.hosted = hosted;
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 60)) / 100;
    for (const voice of this.voices) voice.volume = this.volume / 2;
    if (!enabled || !this.volume) this.stop();
  }
  play(cue: Cue) {
    if (!this.enabled || !this.volume) return;
    const file = cue === 'lock' ? 'chain-bind.wav' : 'chain-fracture.wav';
    if (this.hosted) {
      sceneAudio.play(file, this.volume / 2);
      return;
    }
    let voice = this.voices.find((audio) => audio.paused || audio.ended);
    if (!voice && this.voices.length >= 2) voice = this.voices.shift();
    if (!voice) {
      voice = document.createElement('audio');
      voice.preload = 'auto';
      voice.hidden = true;
      document.body.append(voice);
    }
    if (!this.voices.includes(voice)) this.voices.push(voice);
    voice.pause();
    const url = new URL(file, location.href).href;
    if (voice.src !== url) voice.src = url;
    else voice.currentTime = 0;
    voice.volume = this.volume / 2;
    voice.dataset.chainSound = cue;
    voice.dataset.plays = String(Number(voice.dataset.plays ?? 0) + 1);
    void voice.play().catch(() => {
      voice!.dataset.playbackError = 'true';
    });
  }
  stop() {
    if (this.hosted) sceneAudio.stop();
    for (const voice of this.voices) {
      voice.pause();
      voice.currentTime = 0;
    }
  }
  dispose() {
    this.stop();
    this.enabled = false;
    for (const voice of this.voices) voice.remove();
    this.voices = [];
  }
}

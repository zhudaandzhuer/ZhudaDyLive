import { clips, type ClipId, type Sequence } from "./sequences";

/** Preloaded real films. Hold the actual outgoing decoded frame until the next frame is ready. */
export class DuelFilms {
  private videos = new Map<ClipId, HTMLVideoElement>();
  private visible: HTMLVideoElement | null = null;
  private activeKey = "";
  private pendingKey = "";
  private desired: Sequence | null = null;
  private hold: HTMLCanvasElement;
  private ticket = 0;

  constructor(
    private world: HTMLElement,
    private arena: HTMLElement,
  ) {
    this.hold = document.createElement("canvas");
    this.hold.id = "continuity-frame";
    this.hold.hidden = true;
    for (const [id, asset] of Object.entries(clips)) {
      const video = document.createElement("video");
      video.id = `film-${id}`;
      video.src = `assets/films/${asset.file}`;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.dataset.active = "false";
      video.dataset.clip = id;
      video.addEventListener("error", () => {
        this.arena.dataset.video = "unavailable";
        // Keep the outgoing frame visible. Never replace a missing film with combat VFX.
      });
      this.world.append(video);
      this.videos.set(id as ClipId, video);
    }
    this.world.append(this.hold);
  }

  private freeze() {
    const video = this.visible;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    this.hold.width = video.videoWidth;
    this.hold.height = video.videoHeight;
    this.hold.getContext("2d")!.drawImage(video, 0, 0);
    this.hold.hidden = false;
    this.hold.dataset.fromClip = video.dataset.clip;
    this.hold.dataset.fromTime = video.currentTime.toFixed(4);
    this.hold.dataset.captures = String(
      Number(this.hold.dataset.captures ?? 0) + 1,
    );
    this.arena.dataset.transition = "holding-current-frame";
  }

  sync(next: Sequence) {
    this.desired = next;
    const target = this.videos.get(next.clip)!;
    if (this.activeKey !== next.key) {
      if (this.pendingKey !== next.key) {
        this.ticket++;
        this.pendingKey = next.key;
        this.freeze();
        for (const video of this.videos.values()) video.pause();
        const ticket = this.ticket;
        const reveal = () => {
          if (ticket !== this.ticket || this.desired?.key !== next.key) return;
          const current = this.desired!;
          target.loop = current.loop;
          target.playbackRate = current.rate;
          for (const video of this.videos.values())
            video.dataset.active = String(video === target);
          this.visible = target;
          this.activeKey = next.key;
          this.pendingKey = "";
          this.hold.hidden = true;
          this.arena.dataset.clip = next.clip;
          this.arena.dataset.filmKey = next.key;
          this.arena.dataset.transition = "playing";
          if (current.playing)
            void target.play().catch(() => {
              this.arena.dataset.video = "unavailable";
            });
        };
        const seek = () => {
          if (ticket !== this.ticket) return;
          const current = this.desired!;
          const position = Math.min(
            current.time,
            Math.max(0, target.duration - 1 / 24),
          );
          if (Math.abs(target.currentTime - position) > 1 / 48) {
            target.addEventListener("seeked", reveal, { once: true });
            target.currentTime = position;
          } else reveal();
        };
        if (target.readyState >= 2) seek();
        else target.addEventListener("loadeddata", seek, { once: true });
      }
      return;
    }
    target.loop = next.loop;
    target.playbackRate = next.rate;
    // Correct reconnect/late-load/pause drift, with circular distance for a breathing loop.
    const difference = Math.abs(target.currentTime - next.time);
    const drift = next.loop
      ? Math.min(difference, Math.abs(target.duration - difference))
      : difference;
    const endpoint = next.time >= clips[next.clip].duration - 1 / 24 - 0.001;
    if (
      !target.seeking &&
      Number.isFinite(drift) &&
      (drift > 0.28 || (endpoint && difference > 1 / 48))
    )
      target.currentTime = next.time;
    if (next.playing) {
      if (target.paused && !target.seeking)
        void target.play().catch(() => {
          this.arena.dataset.video = "unavailable";
        });
    } else target.pause();
  }
}

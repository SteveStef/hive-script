import autumnUrl from '../assets/music/autumn-apple-cider.ogg';
import springUrl from '../assets/music/spring-cozy-puzzle-in-game-2.ogg';
import summerUrl from '../assets/music/summer-calm-track.ogg';
import winterUrl from '../assets/music/winter-snow-theme.ogg';
import type { Season } from '../sim/world';

const VOLUME = 0.5; // the whole soundtrack, kept well under the game
const FADE = 3; // seconds to cross-fade when the season changes

const db = (d: number) => 10 ** (d / 20);

// One calm track per season, all CC0 (see CREDITS.md). Their loudness differs by up to 23 dB,
// so each gain brings its track to about -20 LUFS (measured with ffmpeg's ebur128 filter).
const TRACKS: Record<Season, { url: string; gain: number }> = {
  spring: { url: springUrl, gain: db(-8.8) },
  summer: { url: summerUrl, gain: db(-6.1) },
  autumn: { url: autumnUrl, gain: db(-5.2) },
  winter: { url: winterUrl, gain: db(14.4) }, // a quiet recording; its peaks still stay under -3 dB
};

interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * The background music: a loop per season, cross-faded as the year turns. Tracks play from
 * decoded buffers rather than <audio>, since only buffers loop without a gap. Only the
 * current track is kept decoded; a 4-minute track takes about 90 MB.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private playing: Playing | null = null;
  private wanted: Season | null = null;

  constructor(private muted: boolean) {}

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Plays this season's track, fading out the one before; cheap to call every frame. The first
   * call must come from a click or key press, since browsers keep a page silent until then.
   */
  play(season: Season): void {
    if (this.wanted === season) return;
    this.wanted = season;
    const ctx = this.context();
    if (!this.muted) void ctx.resume();
    this.load(season)
      .then(buffer => {
        if (this.wanted === season) this.crossfade(ctx, buffer, TRACKS[season].gain);
      })
      .catch(e => console.warn(`Could not play the ${season} music:`, e));
  }

  /** Muting suspends the audio, so unmuting picks the track up where it stopped. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx) return;
    void (muted ? this.ctx.suspend() : this.ctx.resume());
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = VOLUME;
      this.master.connect(this.ctx.destination);
      if (this.muted) void this.ctx.suspend();
    }
    return this.ctx;
  }

  private async load(season: Season): Promise<AudioBuffer> {
    const res = await fetch(TRACKS[season].url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return this.context().decodeAudioData(await res.arrayBuffer());
  }

  private crossfade(ctx: AudioContext, buffer: AudioBuffer, level: number): void {
    const now = ctx.currentTime;
    const old = this.playing;
    if (old) {
      const g = old.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + FADE);
      old.source.stop(now + FADE);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + FADE);
    gain.connect(this.master!);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.playing = { source, gain };
  }
}

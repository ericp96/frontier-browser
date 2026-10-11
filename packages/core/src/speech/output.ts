/**
 * The assistant's output channel.
 *
 * Every message carries its SOURCE so the shell can render browser messages
 * in a channel pages cannot imitate (AR-1): page content is always framed as
 * coming from the page, AI output as coming from the AI.
 */

export type Source = 'browser' | 'page' | 'ai';
export type AnnouncementKind = 'info' | 'content' | 'alert' | 'confirm' | 'error' | 'hint' | 'list';

export interface Announcement {
  text: string;
  source: Source;
  kind: AnnouncementKind;
  /** BCP-47 language of the text, so TTS can switch voices (AR-23). */
  lang?: string;
}

export type DeliveryResult = 'done' | 'interrupted';

export interface Output {
  /** Resolves when the message has been fully delivered, or was interrupted. */
  announce(a: Announcement): Promise<DeliveryResult>;
  /** Barge-in: stop all speech immediately and drop anything queued. */
  interrupt(): void;
  /** Speech rate multiplier change; text-only outputs ignore it. */
  adjustRate?(delta: number | 'reset'): void;
}

export type Profile = 'voice' | 'screen-reader' | 'braille';
export type Verbosity = 'terse' | 'normal' | 'guided';

const IMPERSONATION = /^\W{0,3}(frontier|browser|system|assistant|security (alert|warning)|warning from|your (screen reader|browser))\b|\bsay\W+(yes|confirm)\b|\bconfirm \w+\W*$/i;

/** Text as it appears in the reviewable log (and braille). */
export function formatForLog(a: Announcement): string {
  switch (a.source) {
    case 'page':
      // Page text that claims to be the browser, the assistant or the system
      // is always reframed, so it can't pass as a browser prompt (AR-1).
      return a.kind === 'content' && !IMPERSONATION.test(a.text) ? a.text : `The page says: ${a.text}`;
    case 'ai':
      return `AI: ${a.text}`;
    default:
      return a.kind === 'confirm' ? `Frontier asks: ${a.text}` : a.text;
  }
}

/** Collects announcements; useful for tests, the CLI and headless use. */
export class RecordingOutput implements Output {
  readonly log: Announcement[] = [];
  interrupts = 0;
  async announce(a: Announcement): Promise<DeliveryResult> {
    this.log.push(a);
    return 'done';
  }
  interrupt(): void {
    this.interrupts++;
  }
  texts(): string[] {
    return this.log.map((a) => a.text);
  }
  last(): Announcement | undefined {
    return this.log[this.log.length - 1];
  }
}

// ---- TTS queue -------------------------------------------------------------

export interface TtsEngine {
  /** Speak one utterance; resolve when finished or cancelled. */
  speak(text: string, opts: { rate: number; lang?: string }): Promise<DeliveryResult>;
  cancel(): void;
}

const PRIORITY: Record<AnnouncementKind, number> = { alert: 0, confirm: 0, error: 1, info: 2, hint: 3, list: 2, content: 4 };

/**
 * Priority queue over a TTS engine with immediate barge-in. Alerts and
 * confirmations jump ahead of content being read.
 */
export class SpeechQueue implements Output {
  private queue: { a: Announcement; resolve: (r: DeliveryResult) => void }[] = [];
  private speaking = false;
  private rate = 1;
  private generation = 0;

  constructor(
    private readonly engine: TtsEngine,
    private readonly onLog?: (a: Announcement) => void,
  ) {}

  announce(a: Announcement): Promise<DeliveryResult> {
    this.onLog?.(a);
    return new Promise((resolve) => {
      const p = PRIORITY[a.kind];
      const idx = this.queue.findIndex((q) => PRIORITY[q.a.kind] > p);
      if (idx === -1) this.queue.push({ a, resolve });
      else this.queue.splice(idx, 0, { a, resolve });
      void this.pump();
    });
  }

  interrupt(): void {
    this.generation++;
    const dropped = this.queue.splice(0);
    for (const d of dropped) d.resolve('interrupted');
    this.engine.cancel();
  }

  adjustRate(delta: number | 'reset'): void {
    this.rate = delta === 'reset' ? 1 : Math.min(3, Math.max(0.5, this.rate + delta));
  }

  get currentRate(): number {
    return this.rate;
  }

  private async pump(): Promise<void> {
    if (this.speaking) return;
    this.speaking = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        const gen = this.generation;
        const spoken = speakable(item.a);
        const r = await this.engine.speak(spoken, { rate: this.rate, lang: item.a.lang });
        item.resolve(gen !== this.generation ? 'interrupted' : r);
      }
    } finally {
      this.speaking = false;
    }
  }
}

/** What actually gets spoken: source framing without visual clutter. */
export function speakable(a: Announcement): string {
  return formatForLog(a).replace(/https?:\/\/\S+/g, 'a link');
}

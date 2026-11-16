import { convert } from '../converter.js';
import { RenderConfig } from '../config.js';
import { MessageEntity } from '../entity.js';
import { richify, telegramifyRich, InputRichMessage } from '../rich.js';
import { StreamCore, StreamState } from './core.js';

/** Telegram's message text limit, in UTF-16 code units. */
export const DRAFT_TEXT_LIMIT = 4096;

const RICH_THINKING_HTML = '<tg-thinking>Thinking...</tg-thinking>';
const RICH_CLEAR_HTML = '<p>…</p>';

export type StreamMode = 'rich' | 'entity';

/** `sendMessageDraft` parameters, minus `chat_id`. */
export interface EntityDraftPayload {
  draft_id: number;
  text: string;
  entities: MessageEntity[];
  can_stop?: boolean;
  keep_on_stop?: boolean;
}

/** `sendRichMessageDraft` parameters, minus `chat_id`. */
export interface RichDraftPayload {
  draft_id: number;
  rich_message: InputRichMessage;
  can_stop?: boolean;
  keep_on_stop?: boolean;
}

/** `sendMessage` (or `editMessageText`) parameters, minus `chat_id`. */
export interface EntityFinalPayload {
  text: string;
  entities: MessageEntity[];
}

/** `sendRichMessage` parameters, minus `chat_id`. */
export interface RichFinalPayload {
  rich_message: InputRichMessage;
}

export type DraftPayload<M extends StreamMode> = M extends 'entity' ? EntityDraftPayload : RichDraftPayload;
export type FinalPayload<M extends StreamMode> = M extends 'entity' ? EntityFinalPayload : RichFinalPayload;

export interface DraftStreamOptions<M extends StreamMode> {
  /** Called with each draft; spread it into `sendMessageDraft` / `sendRichMessageDraft`. */
  sendDraft: (payload: DraftPayload<M>) => Promise<unknown>;
  /** Called once by `finish()`; spread it into `sendMessage` / `sendRichMessage`. */
  sendFinal: (payload: FinalPayload<M>) => Promise<unknown>;
  /** Default 'rich'. */
  mode?: M;
  /** Non-zero integer; generated when omitted. */
  draftId?: number;
  /** Throttle period, ms. Default 300. */
  interval?: number;
  /** Show the thinking indicator for this long before the first real draft, ms. Default 500; null or 0 disables. */
  thinkingDelay?: number | null;
  /** Resend the draft after this long without an update, ms. Default 25000. */
  keepaliveTimeout?: number;
  /** Send a placeholder draft on cancel. Default true, or false when `keepOnStop` is set. */
  cancelClearsDraft?: boolean;
  /** Entity mode only: render config for drafts and the final message. */
  config?: RenderConfig;
  /** Sent as `can_stop` on every draft. */
  canStop?: boolean;
  /** Sent as `keep_on_stop` on every draft. */
  keepOnStop?: boolean;
}

type AnyDraftPayload = EntityDraftPayload | RichDraftPayload;

/** The tail of `text` within `limit` UTF-16 code units, never splitting a surrogate pair. */
export function tailByUtf16(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let start = text.length - limit;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start++;
  return text.slice(start);
}

/**
 * Streams Markdown through Telegram's draft API: throttled `sendDraft` calls
 * while tokens arrive, then one `sendFinal` with the complete message.
 *
 * Drafts are tail-windowed to fit Telegram's limits (4096 UTF-16 units in
 * entity mode, 32 KB of HTML in rich mode). The final payload is a single
 * message; splitting a long one is the caller's job.
 */
export class DraftStream<M extends StreamMode = 'rich'> {
  readonly mode: M;
  readonly draftId: number;

  private readonly sendDraft: (payload: AnyDraftPayload) => Promise<unknown>;
  private readonly sendFinal: (payload: EntityFinalPayload | RichFinalPayload) => Promise<unknown>;
  private readonly config?: RenderConfig;
  private readonly thinkingDelay: number | null;
  private readonly flags: { can_stop?: boolean; keep_on_stop?: boolean } = {};
  private readonly core: StreamCore<AnyDraftPayload>;

  private firstEmit = true;
  private thinkingSuppressed = false;
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: DraftStreamOptions<M>) {
    const mode = (options.mode ?? 'rich') as M;
    if (mode !== 'rich' && mode !== 'entity') {
      throw new RangeError(`mode must be 'rich' or 'entity', got ${JSON.stringify(mode)}`);
    }
    if (options.draftId !== undefined && (!Number.isInteger(options.draftId) || options.draftId === 0)) {
      throw new RangeError(`draftId must be a non-zero integer, got ${options.draftId}`);
    }

    this.mode = mode;
    this.draftId = options.draftId ?? (Math.floor(Math.random() * 0x7fffffff) | 1);
    this.sendDraft = options.sendDraft as (payload: AnyDraftPayload) => Promise<unknown>;
    this.sendFinal = options.sendFinal as (payload: EntityFinalPayload | RichFinalPayload) => Promise<unknown>;
    this.config = options.config;
    this.thinkingDelay = options.thinkingDelay === undefined ? 500 : options.thinkingDelay;
    if (options.canStop !== undefined) this.flags.can_stop = options.canStop;
    if (options.keepOnStop !== undefined) this.flags.keep_on_stop = options.keepOnStop;

    const cancelClearsDraft = options.cancelClearsDraft ?? !options.keepOnStop;

    this.core = new StreamCore<AnyDraftPayload>({
      render: (buffer) => this.render(buffer),
      emit: (payload) => this.emit(payload),
      finalize: () => this.finalize(),
      interval: options.interval ?? 300,
      keepaliveTimeout: options.keepaliveTimeout,
      onCancel: cancelClearsDraft ? () => this.clearDraft() : undefined,
    });
  }

  get buffer(): string {
    return this.core.buffer;
  }

  get state(): StreamState {
    return this.core.state;
  }

  feed(token: string): void {
    this.core.feed(token);
  }

  /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
  consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void> {
    return this.core.consume(tokens);
  }

  /** Stop drafting and send the complete message through `sendFinal`. */
  async finish(): Promise<void> {
    this.closed = true;
    this.cancelThinkingTimer();
    await this.core.finish();
    this.cancelThinkingTimer();
  }

  /** Stop drafting without a final message (e.g. on `stopped_message_generation`). */
  async cancel(): Promise<void> {
    this.closed = true;
    this.cancelThinkingTimer();
    await this.core.cancel();
    this.cancelThinkingTimer();
  }

  private render(buffer: string): AnyDraftPayload {
    if (this.mode === 'entity') {
      let { text, entities } = convert(buffer, { config: this.config });
      // A tail window shifts every offset, and a draft is transient: drop the entities.
      if (text.length > DRAFT_TEXT_LIMIT) {
        text = tailByUtf16(text, DRAFT_TEXT_LIMIT);
        entities = [];
      }
      return this.entityDraft(text, entities);
    }
    // Over Telegram's limits, show the last chunk: it ends where the text does
    // and, unlike a byte tail, stays well-formed
    const chunks = telegramifyRich(buffer);
    return this.richDraft(chunks.length > 0 ? chunks[chunks.length - 1] : richify(buffer));
  }

  private async emit(payload: AnyDraftPayload): Promise<void> {
    if (this.firstEmit) {
      this.firstEmit = false;
      if (this.thinkingDelay && this.thinkingDelay > 0) {
        await this.sendDraft(this.mode === 'entity'
          ? this.entityDraft('', [])
          : this.richDraft({ html: RICH_THINKING_HTML }));
        if (this.closed) return;
        this.thinkingSuppressed = true;
        this.thinkingTimer = setTimeout(() => {
          this.thinkingTimer = null;
          this.thinkingSuppressed = false;
          this.core.markDirty();
        }, this.thinkingDelay);
        return;
      }
    }
    if (this.thinkingSuppressed) return;
    await this.sendDraft(payload);
  }

  private async finalize(): Promise<void> {
    // Re-render without the draft window.
    const buffer = this.core.buffer;
    if (this.mode === 'entity') {
      const { text, entities } = convert(buffer, { config: this.config });
      await this.sendFinal({ text, entities });
    } else {
      await this.sendFinal({ rich_message: richify(buffer) });
    }
  }

  private async clearDraft(): Promise<void> {
    // Telegram rejects empty rich HTML, so rich mode clears to a placeholder.
    const payload = this.mode === 'entity'
      ? this.entityDraft('', [])
      : this.richDraft({ html: RICH_CLEAR_HTML });
    try {
      await this.sendDraft(payload);
    } catch {
      // best-effort
    }
  }

  private entityDraft(text: string, entities: MessageEntity[]): EntityDraftPayload {
    return { draft_id: this.draftId, text, entities, ...this.flags };
  }

  private richDraft(rich_message: InputRichMessage): RichDraftPayload {
    return { draft_id: this.draftId, rich_message, ...this.flags };
  }

  private cancelThinkingTimer(): void {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = null;
    this.thinkingSuppressed = false;
  }
}

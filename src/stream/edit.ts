import { convert } from '../converter.js';
import { RenderConfig } from '../config.js';
import { richify } from '../rich.js';
import { StreamCore, StreamState } from './core.js';
import { EntityFinalPayload, FinalPayload, RichFinalPayload, StreamMode } from './draft.js';

/** Telegram allows roughly one edit per second per message. */
export const EDIT_MIN_INTERVAL = 1000;

export interface EditStreamOptions<M extends StreamMode> {
  /** Sends the first snapshot and resolves to its message_id. */
  sendMessage: (payload: FinalPayload<M>) => Promise<number>;
  /** Replaces the message's content with a newer snapshot. */
  editMessage: (messageId: number, payload: FinalPayload<M>) => Promise<unknown>;
  /** Default 'rich'. */
  mode?: M;
  /** Throttle period, ms; at least 1000. Default 1000. */
  interval?: number;
  /** Re-edit after this long without an update, ms. Default 25000. */
  keepaliveTimeout?: number;
  /** Entity mode only: render config for every edit and the final message. */
  config?: RenderConfig;
}

type AnyFinalPayload = EntityFinalPayload | RichFinalPayload;

/**
 * Streams Markdown by sending one message and editing it as tokens arrive,
 * for chats where the draft API is unavailable (groups, channels). `finish()`
 * makes one last edit with the complete content.
 */
export class EditStream<M extends StreamMode = 'rich'> {
  readonly mode: M;

  private readonly sendMessage: (payload: AnyFinalPayload) => Promise<number>;
  private readonly editMessage: (messageId: number, payload: AnyFinalPayload) => Promise<unknown>;
  private readonly config?: RenderConfig;
  private readonly core: StreamCore<AnyFinalPayload>;
  private _messageId: number | null = null;

  constructor(options: EditStreamOptions<M>) {
    const interval = options.interval ?? EDIT_MIN_INTERVAL;
    if (!(interval >= EDIT_MIN_INTERVAL)) {
      throw new RangeError(
        `EditStream interval must be >= ${EDIT_MIN_INTERVAL}ms (Telegram edit rate limit), got ${interval}`
      );
    }
    const mode = (options.mode ?? 'rich') as M;
    if (mode !== 'rich' && mode !== 'entity') {
      throw new RangeError(`mode must be 'rich' or 'entity', got ${JSON.stringify(mode)}`);
    }

    this.mode = mode;
    this.sendMessage = options.sendMessage as (payload: AnyFinalPayload) => Promise<number>;
    this.editMessage = options.editMessage as (messageId: number, payload: AnyFinalPayload) => Promise<unknown>;
    this.config = options.config;

    this.core = new StreamCore<AnyFinalPayload>({
      render: (buffer) => this.render(buffer),
      emit: (payload) => this.deliver(payload),
      finalize: (payload) => this.deliver(payload),
      interval,
      keepaliveTimeout: options.keepaliveTimeout,
    });
  }

  get buffer(): string {
    return this.core.buffer;
  }

  get state(): StreamState {
    return this.core.state;
  }

  /** The sent message's id, once the first snapshot is out. */
  get messageId(): number | null {
    return this._messageId;
  }

  feed(token: string): void {
    this.core.feed(token);
  }

  /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
  consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void> {
    return this.core.consume(tokens);
  }

  /** Stop streaming and edit in the complete content (or send it, if nothing went out yet). */
  finish(): Promise<void> {
    return this.core.finish();
  }

  /** Stop streaming; the message keeps whatever it last showed. */
  cancel(): Promise<void> {
    return this.core.cancel();
  }

  private render(buffer: string): AnyFinalPayload {
    if (this.mode === 'entity') {
      const { text, entities } = convert(buffer, { config: this.config });
      return { text, entities };
    }
    return { rich_message: richify(buffer) };
  }

  /** The first payload is sent; later ones edit it. */
  private async deliver(payload: AnyFinalPayload): Promise<void> {
    if (this._messageId === null) {
      this._messageId = await this.sendMessage(payload);
    } else {
      await this.editMessage(this._messageId, payload);
    }
  }
}

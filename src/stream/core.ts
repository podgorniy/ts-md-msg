/**
 * Protocol-agnostic throttled streaming buffer.
 *
 * StreamCore accumulates tokens into a buffer, renders it on a throttled
 * schedule through an injected `render`, delivers snapshots through `emit` and
 * the last one through `finalize`. It knows nothing about Telegram, Markdown or
 * rich HTML; DraftStream and EditStream supply those.
 *
 * All durations are milliseconds.
 */

const BUFFER_WARNING_BYTES = 512 * 1024;
const MAX_CONSECUTIVE_FAILURES = 3;

export type StreamState = 'idle' | 'active' | 'done';

export interface StreamCoreOptions<T> {
  /** Buffer to payload. Called on every tick and once more on finish. */
  render: (buffer: string) => T;
  /** Delivers an intermediate snapshot. */
  emit: (payload: T) => Promise<unknown>;
  /** Delivers the final payload. Errors propagate out of `finish()`. */
  finalize: (payload: T) => Promise<unknown>;
  /** Throttle period, ms. Default 300. */
  interval?: number;
  /** Resend the current state after this long without a successful emit, ms. Default 25000. */
  keepaliveTimeout?: number;
  /** Called once by `cancel()`. */
  onCancel?: () => Promise<unknown>;
}

export class StreamCore<T> {
  private readonly render: (buffer: string) => T;
  private readonly emit: (payload: T) => Promise<unknown>;
  private readonly finalize: (payload: T) => Promise<unknown>;
  private readonly interval: number;
  private readonly keepaliveTimeout: number;
  private readonly onCancel?: () => Promise<unknown>;

  private _buffer = '';
  private _state: StreamState = 'idle';
  private dirty = false;
  private closing = false;
  private consecutiveFailures = 0;
  private degraded = false;
  private bufferWarned = false;
  private keepaliveExpired = false;

  private inflight: Promise<void> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StreamCoreOptions<T>) {
    const interval = options.interval ?? 300;
    if (!(interval > 0)) {
      throw new RangeError(`interval must be positive, got ${interval}`);
    }
    this.render = options.render;
    this.emit = options.emit;
    this.finalize = options.finalize;
    this.interval = interval;
    this.keepaliveTimeout = options.keepaliveTimeout ?? 25000;
    this.onCancel = options.onCancel;
  }

  get buffer(): string {
    return this._buffer;
  }

  get state(): StreamState {
    return this._state;
  }

  /** Append a token. The next tick renders and emits the whole buffer. */
  feed(token: string): void {
    if (this._state === 'done') {
      throw new Error('Cannot feed after stream is done');
    }
    this._buffer += token;
    this.dirty = true;

    if (!this.bufferWarned && this._buffer.length * 3 > BUFFER_WARNING_BYTES) {
      const bytes = new TextEncoder().encode(this._buffer).length;
      if (bytes > BUFFER_WARNING_BYTES) {
        console.warn(`Stream buffer exceeds 512KB (${bytes} bytes). Did you forget to call finish()?`);
        this.bufferWarned = true;
      }
    }

    if (this._state === 'idle') {
      this._state = 'active';
      this.scheduleTick();
    }
  }

  /**
   * Feed every token from `tokens`, then finish. If the iterable throws, the
   * stream is cancelled and the error rethrown. If the stream is finished or
   * cancelled elsewhere meanwhile, iteration stops quietly.
   */
  async consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void> {
    try {
      for await (const token of tokens) {
        if (this._state === 'done' || this.closing) return;
        this.feed(token);
      }
    } catch (err) {
      await this.cancel();
      throw err;
    }
    await this.finish();
  }

  /** End the stream and deliver the final payload. Idempotent. */
  async finish(): Promise<void> {
    if (this._state === 'done' || this.closing) return;
    this.closing = true;
    this.cancelTimers();
    if (this.inflight) await this.inflight;
    if ((this._state as StreamState) === 'done') return; // cancelled meanwhile
    this._state = 'done';
    this.cancelTimers();

    if (this._buffer) {
      await this.finalize(this.render(this._buffer));
    }
  }

  /** End the stream without a final payload, then call `onCancel`. Idempotent. */
  async cancel(): Promise<void> {
    if (this._state === 'done') return;
    this._state = 'done';
    this.cancelTimers();
    // Let an in-flight emit land first, so onCancel's clean-up is the last word.
    if (this.inflight) await this.inflight;
    if (this.onCancel) await this.onCancel();
  }

  /** Force the next tick to emit even if nothing was fed since the last one. */
  markDirty(): void {
    this.dirty = true;
  }

  private scheduleTick(): void {
    if (this._state === 'done' || this.closing) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      if (this._state === 'done' || this.closing) return;
      this.inflight = this.tick().finally(() => {
        this.inflight = null;
      });
    }, this.interval);
  }

  private async tick(): Promise<void> {
    if (!this.dirty && !this.keepaliveExpired) {
      this.scheduleTick();
      return;
    }
    if (this.degraded) {
      this.dirty = false;
      this.scheduleTick();
      return;
    }

    try {
      await this.emit(this.render(this._buffer));
      this.dirty = false;
      this.consecutiveFailures = 0;
      this.resetKeepalive();
    } catch (err) {
      this.consecutiveFailures++;
      console.warn(`emit failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err}`);
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn('Entering degraded mode: emit disabled');
        this.degraded = true;
      }
    }
    this.scheduleTick();
  }

  private resetKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.keepaliveExpired = false;
    if (this._state === 'done' || this.closing) return;
    this.keepaliveTimer = setTimeout(() => {
      this.keepaliveTimer = null;
      this.keepaliveExpired = true;
    }, this.keepaliveTimeout);
  }

  private cancelTimers(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.tickTimer = null;
    this.keepaliveTimer = null;
  }
}

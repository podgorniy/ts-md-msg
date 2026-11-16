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
export declare class StreamCore<T> {
    private readonly render;
    private readonly emit;
    private readonly finalize;
    private readonly interval;
    private readonly keepaliveTimeout;
    private readonly onCancel?;
    private _buffer;
    private _state;
    private dirty;
    private closing;
    private consecutiveFailures;
    private degraded;
    private bufferWarned;
    private keepaliveExpired;
    private inflight;
    private tickTimer;
    private keepaliveTimer;
    constructor(options: StreamCoreOptions<T>);
    get buffer(): string;
    get state(): StreamState;
    /** Append a token. The next tick renders and emits the whole buffer. */
    feed(token: string): void;
    /**
     * Feed every token from `tokens`, then finish. If the iterable throws, the
     * stream is cancelled and the error rethrown. If the stream is finished or
     * cancelled elsewhere meanwhile, iteration stops quietly.
     */
    consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void>;
    /** End the stream and deliver the final payload. Idempotent. */
    finish(): Promise<void>;
    /** End the stream without a final payload, then call `onCancel`. Idempotent. */
    cancel(): Promise<void>;
    /** Force the next tick to emit even if nothing was fed since the last one. */
    markDirty(): void;
    private scheduleTick;
    private tick;
    private resetKeepalive;
    private cancelTimers;
}

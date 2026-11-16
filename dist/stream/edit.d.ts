import { RenderConfig } from '../config.js';
import { StreamState } from './core.js';
import { FinalPayload, StreamMode } from './draft.js';
/** Telegram allows roughly one edit per second per message. */
export declare const EDIT_MIN_INTERVAL = 1000;
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
/**
 * Streams Markdown by sending one message and editing it as tokens arrive,
 * for chats where the draft API is unavailable (groups, channels). `finish()`
 * makes one last edit with the complete content.
 */
export declare class EditStream<M extends StreamMode = 'rich'> {
    readonly mode: M;
    private readonly sendMessage;
    private readonly editMessage;
    private readonly config?;
    private readonly core;
    private _messageId;
    constructor(options: EditStreamOptions<M>);
    get buffer(): string;
    get state(): StreamState;
    /** The sent message's id, once the first snapshot is out. */
    get messageId(): number | null;
    feed(token: string): void;
    /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
    consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void>;
    /** Stop streaming and edit in the complete content (or send it, if nothing went out yet). */
    finish(): Promise<void>;
    /** Stop streaming; the message keeps whatever it last showed. */
    cancel(): Promise<void>;
    private render;
    /** The first payload is sent; later ones edit it. */
    private deliver;
}

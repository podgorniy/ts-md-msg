import { RenderConfig } from '../config.js';
import { MessageEntity } from '../entity.js';
import { InputRichMessage } from '../rich.js';
import { StreamState } from './core.js';
/** Telegram's message text limit, in UTF-16 code units. */
export declare const DRAFT_TEXT_LIMIT = 4096;
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
/** The tail of `text` within `limit` UTF-16 code units, never splitting a surrogate pair. */
export declare function tailByUtf16(text: string, limit: number): string;
/**
 * Streams Markdown through Telegram's draft API: throttled `sendDraft` calls
 * while tokens arrive, then one `sendFinal` with the complete message.
 *
 * Drafts are tail-windowed to fit Telegram's limits (4096 UTF-16 units in
 * entity mode, 32 KB of HTML in rich mode). The final payload is a single
 * message; splitting a long one is the caller's job.
 */
export declare class DraftStream<M extends StreamMode = 'rich'> {
    readonly mode: M;
    readonly draftId: number;
    private readonly sendDraft;
    private readonly sendFinal;
    private readonly config?;
    private readonly thinkingDelay;
    private readonly flags;
    private readonly core;
    private firstEmit;
    private thinkingSuppressed;
    private thinkingTimer;
    private closed;
    constructor(options: DraftStreamOptions<M>);
    get buffer(): string;
    get state(): StreamState;
    feed(token: string): void;
    /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
    consume(tokens: AsyncIterable<string> | Iterable<string>): Promise<void>;
    /** Stop drafting and send the complete message through `sendFinal`. */
    finish(): Promise<void>;
    /** Stop drafting without a final message (e.g. on `stopped_message_generation`). */
    cancel(): Promise<void>;
    private render;
    private emit;
    private finalize;
    private clearDraft;
    private entityDraft;
    private richDraft;
    private cancelThinkingTimer;
}

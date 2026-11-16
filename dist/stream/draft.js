import { convert } from '../converter.js';
import { richify, telegramifyRich } from '../rich.js';
import { StreamCore } from './core.js';
/** Telegram's message text limit, in UTF-16 code units. */
export const DRAFT_TEXT_LIMIT = 4096;
const RICH_THINKING_HTML = '<tg-thinking>Thinking...</tg-thinking>';
const RICH_CLEAR_HTML = '<p>…</p>';
/** The tail of `text` within `limit` UTF-16 code units, never splitting a surrogate pair. */
export function tailByUtf16(text, limit) {
    if (text.length <= limit)
        return text;
    let start = text.length - limit;
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff)
        start++;
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
export class DraftStream {
    mode;
    draftId;
    sendDraft;
    sendFinal;
    config;
    thinkingDelay;
    flags = {};
    core;
    firstEmit = true;
    thinkingSuppressed = false;
    thinkingTimer = null;
    closed = false;
    constructor(options) {
        const mode = (options.mode ?? 'rich');
        if (mode !== 'rich' && mode !== 'entity') {
            throw new RangeError(`mode must be 'rich' or 'entity', got ${JSON.stringify(mode)}`);
        }
        if (options.draftId !== undefined && (!Number.isInteger(options.draftId) || options.draftId === 0)) {
            throw new RangeError(`draftId must be a non-zero integer, got ${options.draftId}`);
        }
        this.mode = mode;
        this.draftId = options.draftId ?? (Math.floor(Math.random() * 0x7fffffff) | 1);
        this.sendDraft = options.sendDraft;
        this.sendFinal = options.sendFinal;
        this.config = options.config;
        this.thinkingDelay = options.thinkingDelay === undefined ? 500 : options.thinkingDelay;
        if (options.canStop !== undefined)
            this.flags.can_stop = options.canStop;
        if (options.keepOnStop !== undefined)
            this.flags.keep_on_stop = options.keepOnStop;
        const cancelClearsDraft = options.cancelClearsDraft ?? !options.keepOnStop;
        this.core = new StreamCore({
            render: (buffer) => this.render(buffer),
            emit: (payload) => this.emit(payload),
            finalize: () => this.finalize(),
            interval: options.interval ?? 300,
            keepaliveTimeout: options.keepaliveTimeout,
            onCancel: cancelClearsDraft ? () => this.clearDraft() : undefined,
        });
    }
    get buffer() {
        return this.core.buffer;
    }
    get state() {
        return this.core.state;
    }
    feed(token) {
        this.core.feed(token);
    }
    /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
    consume(tokens) {
        return this.core.consume(tokens);
    }
    /** Stop drafting and send the complete message through `sendFinal`. */
    async finish() {
        this.closed = true;
        this.cancelThinkingTimer();
        await this.core.finish();
        this.cancelThinkingTimer();
    }
    /** Stop drafting without a final message (e.g. on `stopped_message_generation`). */
    async cancel() {
        this.closed = true;
        this.cancelThinkingTimer();
        await this.core.cancel();
        this.cancelThinkingTimer();
    }
    render(buffer) {
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
    async emit(payload) {
        if (this.firstEmit) {
            this.firstEmit = false;
            if (this.thinkingDelay && this.thinkingDelay > 0) {
                await this.sendDraft(this.mode === 'entity'
                    ? this.entityDraft('', [])
                    : this.richDraft({ html: RICH_THINKING_HTML }));
                if (this.closed)
                    return;
                this.thinkingSuppressed = true;
                this.thinkingTimer = setTimeout(() => {
                    this.thinkingTimer = null;
                    this.thinkingSuppressed = false;
                    this.core.markDirty();
                }, this.thinkingDelay);
                return;
            }
        }
        if (this.thinkingSuppressed)
            return;
        await this.sendDraft(payload);
    }
    async finalize() {
        // Re-render without the draft window.
        const buffer = this.core.buffer;
        if (this.mode === 'entity') {
            const { text, entities } = convert(buffer, { config: this.config });
            await this.sendFinal({ text, entities });
        }
        else {
            await this.sendFinal({ rich_message: richify(buffer) });
        }
    }
    async clearDraft() {
        // Telegram rejects empty rich HTML, so rich mode clears to a placeholder.
        const payload = this.mode === 'entity'
            ? this.entityDraft('', [])
            : this.richDraft({ html: RICH_CLEAR_HTML });
        try {
            await this.sendDraft(payload);
        }
        catch {
            // best-effort
        }
    }
    entityDraft(text, entities) {
        return { draft_id: this.draftId, text, entities, ...this.flags };
    }
    richDraft(rich_message) {
        return { draft_id: this.draftId, rich_message, ...this.flags };
    }
    cancelThinkingTimer() {
        if (this.thinkingTimer)
            clearTimeout(this.thinkingTimer);
        this.thinkingTimer = null;
        this.thinkingSuppressed = false;
    }
}

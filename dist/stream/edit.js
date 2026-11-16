import { convert } from '../converter.js';
import { richify } from '../rich.js';
import { StreamCore } from './core.js';
/** Telegram allows roughly one edit per second per message. */
export const EDIT_MIN_INTERVAL = 1000;
/**
 * Streams Markdown by sending one message and editing it as tokens arrive,
 * for chats where the draft API is unavailable (groups, channels). `finish()`
 * makes one last edit with the complete content.
 */
export class EditStream {
    mode;
    sendMessage;
    editMessage;
    config;
    core;
    _messageId = null;
    constructor(options) {
        const interval = options.interval ?? EDIT_MIN_INTERVAL;
        if (!(interval >= EDIT_MIN_INTERVAL)) {
            throw new RangeError(`EditStream interval must be >= ${EDIT_MIN_INTERVAL}ms (Telegram edit rate limit), got ${interval}`);
        }
        const mode = (options.mode ?? 'rich');
        if (mode !== 'rich' && mode !== 'entity') {
            throw new RangeError(`mode must be 'rich' or 'entity', got ${JSON.stringify(mode)}`);
        }
        this.mode = mode;
        this.sendMessage = options.sendMessage;
        this.editMessage = options.editMessage;
        this.config = options.config;
        this.core = new StreamCore({
            render: (buffer) => this.render(buffer),
            emit: (payload) => this.deliver(payload),
            finalize: (payload) => this.deliver(payload),
            interval,
            keepaliveTimeout: options.keepaliveTimeout,
        });
    }
    get buffer() {
        return this.core.buffer;
    }
    get state() {
        return this.core.state;
    }
    /** The sent message's id, once the first snapshot is out. */
    get messageId() {
        return this._messageId;
    }
    feed(token) {
        this.core.feed(token);
    }
    /** Feed every token, then finish; cancels and rethrows if the iterable throws. */
    consume(tokens) {
        return this.core.consume(tokens);
    }
    /** Stop streaming and edit in the complete content (or send it, if nothing went out yet). */
    finish() {
        return this.core.finish();
    }
    /** Stop streaming; the message keeps whatever it last showed. */
    cancel() {
        return this.core.cancel();
    }
    render(buffer) {
        if (this.mode === 'entity') {
            const { text, entities } = convert(buffer, { config: this.config });
            return { text, entities };
        }
        return { rich_message: richify(buffer) };
    }
    /** The first payload is sent; later ones edit it. */
    async deliver(payload) {
        if (this._messageId === null) {
            this._messageId = await this.sendMessage(payload);
        }
        else {
            await this.editMessage(this._messageId, payload);
        }
    }
}

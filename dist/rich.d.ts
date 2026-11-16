import { ParseOptions } from './converter.js';
export type RichMode = 'html' | 'markdown';
/** Parser options for the Rich HTML backend. */
export declare const RICH_OPTIONS: ParseOptions;
export declare const RICH_BYTE_LIMIT = 32768;
export declare const RICH_BLOCK_LIMIT = 500;
export declare const RICH_MEDIA_LIMIT = 50;
/**
 * Telegram `InputRichMessageMedia` (Bot API 10.2): a media file referenced from
 * the html or markdown content through a `tg://photo?id=`, `tg://video?id=`,
 * `tg://document?id=` or `tg://audio?id=` link.
 */
export interface InputRichMessageMedia {
    /** 1-64 characters: A-Z, a-z, 0-9, `_` and `-`. */
    id: string;
    /** An `InputMedia*` object; only the media itself and its properties are used. */
    media: Record<string, any>;
}
/**
 * Telegram `InputRichMessage`, in the exact shape the Bot API expects: pass it
 * as the `rich_message` parameter of `sendRichMessage` without conversion.
 * Exactly one of `html` or `markdown` is set.
 */
export interface InputRichMessage {
    html?: string;
    markdown?: string;
    media?: InputRichMessageMedia[];
    is_rtl?: boolean;
    skip_entity_detection?: boolean;
}
/** One top-level block of rendered Rich HTML and what it counts against Telegram's limits. */
export interface RichBlock {
    html: string;
    byteLen: number;
    /** Blocks Telegram counts, nested blocks, list items and table rows included. */
    blockCount: number;
    mediaCount: number;
}
export interface RichLimits {
    byteLimit?: number;
    blockLimit?: number;
    mediaLimit?: number;
}
export interface RichifyOptions {
    mode?: RichMode;
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;
    /** Media the content references through tg://photo?id= (and video, audio, document) links. */
    media?: InputRichMessageMedia[];
}
/**
 * Convert Markdown to a Telegram InputRichMessage for sendRichMessage.
 *
 * `mode: 'html'` renders Telegram Rich HTML; `mode: 'markdown'` passes the input
 * through for Telegram to render as Rich Markdown.
 */
export declare function richify(markdown: string, options?: RichifyOptions): InputRichMessage;
/**
 * Split an InputRichMessage into chunks within Telegram's limits (32768 bytes,
 * 500 blocks, 50 media by default). HTML splits at block boundaries recovered
 * from the markup; Markdown splits at blank lines by bytes only.
 */
export declare function splitRich(richMessage: InputRichMessage, options?: RichLimits): InputRichMessage[];
/**
 * Convert Markdown into InputRichMessage chunks that each fit Telegram's limits.
 * In html mode the chunks split at the exact block boundaries of the source.
 */
export declare function telegramifyRich(markdown: string, options?: RichifyOptions & RichLimits): InputRichMessage[];

export type RichMode = 'html' | 'markdown';
export declare const RICH_BYTE_LIMIT = 32768;
export declare const RICH_BLOCK_LIMIT = 500;
export interface InputRichMessage {
    html?: string;
    markdown?: string;
    isRtl?: boolean;
    skipEntityDetection?: boolean;
}
export interface RichBlock {
    html: string;
    byteLen: number;
    blockCount: number;
}
export declare function richify(markdown: string, options?: {
    mode?: RichMode;
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;
}): InputRichMessage;
export declare function splitRich(richMessage: InputRichMessage, options?: {
    byteLimit?: number;
    blockLimit?: number;
}): InputRichMessage[];
export declare function telegramifyRich(markdown: string, options?: {
    mode?: RichMode;
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;
    byteLimit?: number;
    blockLimit?: number;
}): InputRichMessage[];

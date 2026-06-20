export interface MessageEntity {
    type: string;
    offset: number;
    length: number;
    url?: string;
    language?: string;
    custom_emoji_id?: string;
    user?: any;
    unix_time?: number;
    date_time_format?: string;
}
/**
 * Returns the length of text measured in UTF-16 code units.
 * In TypeScript/JavaScript, string.length is already the number of UTF-16 code units.
 */
export declare function utf16Len(text: string): number;
/**
 * Split (text, entities) into chunks not exceeding maxUtf16Len UTF-16 code units.
 * Tries to split at newline boundaries. Entities that span a split boundary
 * are clipped into both chunks.
 */
export declare function splitEntities(text: string, entities: MessageEntity[], maxUtf16Len: number): {
    text: string;
    entities: MessageEntity[];
}[];

import { MessageEntity } from './entity.js';
export declare function entitiesToMarkdownV2(text: string, entities?: MessageEntity[]): string;
export declare function splitMarkdownV2(text: string, entities?: MessageEntity[], maxUtf16Len?: number): string[];

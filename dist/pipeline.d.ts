import { Content } from './content.js';
export declare function processMarkdown(content: string, options?: {
    maxMessageLength?: number;
    latexEscape?: boolean;
    renderMermaid?: boolean;
    minFileLines?: number;
}): Promise<Content[]>;
export declare function telegramify(content: string, options?: {
    maxMessageLength?: number;
    latexEscape?: boolean;
    renderMermaid?: boolean;
    minFileLines?: number;
}): Promise<Content[]>;
export declare function markdownify(content: string, options?: {
    latexEscape?: boolean;
}): string;

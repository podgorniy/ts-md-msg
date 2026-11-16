import { RenderConfig } from './config.js';
import { Content } from './content.js';
export declare function processMarkdown(content: string, options?: {
    maxMessageLength?: number;
    latexEscape?: boolean;
    renderMermaid?: boolean;
    minFileLines?: number;
    config?: RenderConfig;
}): Promise<Content[]>;
export declare function telegramify(content: string, options?: {
    maxMessageLength?: number;
    latexEscape?: boolean;
    renderMermaid?: boolean;
    minFileLines?: number;
    /** Render configuration; the global one when omitted. Pass RenderConfig.isolated() for per-request settings. */
    config?: RenderConfig;
}): Promise<Content[]>;
export declare function markdownify(content: string, options?: {
    latexEscape?: boolean;
    config?: RenderConfig;
}): string;

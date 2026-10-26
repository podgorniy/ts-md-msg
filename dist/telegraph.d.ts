/**
 * Telegraph (telegra.ph) page content: https://telegra.ph/api#Node
 *
 * The API accepts only the tags below and only the `href`/`src` attributes, so everything markdown
 * can say that Telegraph cannot (h1/h2, tables, nested lists, code languages, spoilers, math) is
 * mapped onto this set here rather than left for the server to reject.
 */
export type TelegraphTag = 'a' | 'aside' | 'b' | 'blockquote' | 'br' | 'code' | 'em' | 'figcaption' | 'figure' | 'h3' | 'h4' | 'hr' | 'i' | 'iframe' | 'img' | 'li' | 'ol' | 'p' | 'pre' | 's' | 'strong' | 'u' | 'ul' | 'video';
export interface TelegraphAttrs {
    href?: string;
    src?: string;
}
export interface TelegraphElement {
    tag: TelegraphTag;
    attrs?: TelegraphAttrs;
    children?: TelegraphNode[];
}
export type TelegraphNode = string | TelegraphElement;
export declare const TELEGRAPH_TAGS: readonly TelegraphTag[];
/**
 * Markdown → Telegraph `Node[]`, parsed by the same pulldown-cmark pass `richify` uses, so a text reads
 * the same on the page as in the chat.
 */
export declare function toTelegraphNodes(markdown: string, options?: {
    latexEscape?: boolean;
}): TelegraphNode[];
/** The size Telegraph's content limit is measured on: UTF-8 bytes of the JSON array, unescaped. */
export declare function telegraphByteLength(nodes: readonly TelegraphNode[]): number;
/**
 * Packs top-level nodes into pages of at most `budgetBytes` (as `telegraphByteLength` counts them),
 * splitting only a node that cannot fit a page on its own. Order is kept; no page is empty.
 */
export declare function splitTelegraphNodes(nodes: readonly TelegraphNode[], budgetBytes: number): TelegraphNode[][];
/** True when every element of `nodes` uses an allowed tag and only `href`/`src`. */
export declare function isTelegraphSafe(nodes: readonly TelegraphNode[]): boolean;

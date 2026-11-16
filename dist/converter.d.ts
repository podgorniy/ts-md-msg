import * as md from '../native/index.js';
import { RenderConfig } from './config.js';
import { MessageEntity } from './entity.js';
import { Event, Range, Segment } from './types.js';
export type ParseOptions = md.MarkdownOptions;
/** Parser options for the entity backend. */
export declare const STANDARD_OPTIONS: ParseOptions;
/**
 * Replace ||spoiler|| with <tg-spoiler>spoiler</tg-spoiler>, leaving fenced,
 * indented and inline code alone. `options` must match the ones the result is
 * parsed with: footnotes, for instance, change what counts as indented code.
 */
export declare function preprocessSpoilers(text: string, options?: ParseOptions): string;
export declare function validateTelegramEmoji(url: string): string | null;
export declare function escapeLatex(text: string): string;
/**
 * Preprocess and parse Markdown; return the parsed text and its ranged events.
 * Ranges are UTF-8 byte offsets into the returned text.
 *
 * Inline math closed by a `$` that a digit follows (`$10.49 (~$11.20)`) and
 * single-tilde strikethrough are rarely what chat text means, so their
 * delimiters are escaped and the text parsed again until neither remains.
 */
export declare function parseMarkdown(markdown: string, options: ParseOptions, latexEscape: boolean): {
    text: string;
    events: [Event, Range][];
};
export declare class EventWalker {
    private _buf;
    private _entityStack;
    private _entities;
    private _segments;
    private _config;
    private _sourceBytes;
    private _blockCount;
    private _lastBlockStart;
    private _listStack;
    private _itemStarted;
    private _itemIndent;
    private _inTable;
    private _tableAlignments;
    private _tableRows;
    private _currentRow;
    private _cellParts;
    private _inTableCell;
    private _inCodeBlock;
    private _codeBlockLang;
    private _codeBlockParts;
    private _codeBlockStartSource;
    private _inHeading;
    private _headingEntities;
    private _blockquoteScopes;
    constructor(config: RenderConfig, sourceMarkdown: string);
    walk(events: [Event, Range][]): {
        text: string;
        entities: MessageEntity[];
        segments: Segment[];
    };
    private handleEvent;
    private onStart;
    private onEnd;
    private onText;
    private onSoftBreak;
    private onHardBreak;
    private onRule;
    private onInlineCode;
    private onInlineMath;
    private onDisplayMath;
    private onInlineHtml;
    private onTaskListMarker;
    private onStartHeading;
    private onEndHeading;
    private onStartParagraph;
    private onEndParagraph;
    private onStartCodeBlock;
    private onEndCodeBlock;
    private onStartBlockQuote;
    private onEndBlockQuote;
    private onStartLink;
    private onStartImage;
    private onStartList;
    private onStartItem;
    private onEndItem;
    private onEndList;
    private onStartTable;
    private onEndTableCell;
    private onEndTableRow;
    private onEndTable;
    private formatTable;
    private pushEntity;
    private popEntity;
    private popEntityAny;
    private finalizeEntity;
    private markBlockEnd;
    /**
     * Whether the source holds a blank line just before nextBlockStart (a UTF-8
     * byte offset). Scans back, skipping indentation and blockquote markers, and
     * stops at the previous block's start. Block end ranges cannot answer this:
     * a List range swallows the blank line after the list.
     */
    private hasExtraBlankLine;
    private ensureBlockSpacing;
}
export declare function convertWithSegments(markdown: string, options?: {
    latexEscape?: boolean;
    config?: RenderConfig;
}): {
    text: string;
    entities: MessageEntity[];
    segments: Segment[];
};
export declare function convert(markdown: string, options?: {
    latexEscape?: boolean;
    config?: RenderConfig;
}): {
    text: string;
    entities: MessageEntity[];
};

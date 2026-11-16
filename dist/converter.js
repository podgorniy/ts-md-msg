import * as md from '../native/index.js';
import { getRuntimeConfig } from './config.js';
import { utf16Len } from './entity.js';
import { LatexToUnicodeHelper } from './latex/helper.js';
const _latexHelper = new LatexToUnicodeHelper();
/** Parser options for the entity backend. */
export const STANDARD_OPTIONS = {
    enableTables: true,
    enableStrikethrough: true,
    enableTasklists: true,
    enableMath: true,
    enableFootnotes: true,
};
function parseEvents(text, options) {
    return JSON.parse(md.parse(text, options));
}
const _SPOILER_RE = /(?<![\\])\|\|([\s\S]+?)\|\|/g;
// A line break plus the blockquote markers that open the next line. Indentation
// alone stays with the text: in front of the tag it could start indented code.
const _LINE_BREAK = '(?:\\r\\n?|\\n)(?:[ \\t]*>[ \\t]?)*';
const _SPOILER_EDGES_RE = new RegExp(`^((?:[ \\t]*${_LINE_BREAK})*)([\\s\\S]*?)((?:${_LINE_BREAK}[ \\t]*)*)$`);
/**
 * Wrap ||...|| in <tg-spoiler>, keeping the open tag off a line of its own.
 * CommonMark reads a line holding nothing but an open tag as an HTML block,
 * which the converter drops, so line breaks at either edge stay outside.
 */
function spoilerReplacement(match, body) {
    const edges = _SPOILER_EDGES_RE.exec(body);
    const [, leading, inner, trailing] = edges;
    if (!inner)
        return match;
    return `${leading}<tg-spoiler>${inner}</tg-spoiler>${trailing}`;
}
/** UTF-8 byte ranges of the source the parser treats as code, in document order. */
function codeRegions(text, options) {
    const regions = [];
    for (const [event, range] of parseEvents(text, options)) {
        if (typeof event !== 'object')
            continue;
        const isCodeBlock = 'Start' in event && typeof event.Start === 'object' && 'CodeBlock' in event.Start;
        if (isCodeBlock || 'Code' in event)
            regions.push([range.start, range.end]);
    }
    return regions;
}
/**
 * Replace ||spoiler|| with <tg-spoiler>spoiler</tg-spoiler>, leaving fenced,
 * indented and inline code alone. `options` must match the ones the result is
 * parsed with: footnotes, for instance, change what counts as indented code.
 */
export function preprocessSpoilers(text, options = STANDARD_OPTIONS) {
    if (!text.includes('||'))
        return text;
    const data = Buffer.from(text, 'utf8');
    const parts = [];
    let cursor = 0;
    for (const [start, end] of codeRegions(text, options)) {
        parts.push(data.toString('utf8', cursor, start).replace(_SPOILER_RE, spoilerReplacement));
        parts.push(data.toString('utf8', start, end));
        cursor = end;
    }
    parts.push(data.toString('utf8', cursor).replace(_SPOILER_RE, spoilerReplacement));
    return parts.join('');
}
export function validateTelegramEmoji(url) {
    if (!url.startsWith('tg://emoji?id='))
        return null;
    const emojiId = url.replace('tg://emoji?id=', '');
    if (/^\d{19}$/.test(emojiId))
        return emojiId;
    return null;
}
const _LATEX_MATH_P = /\\\[([\s\S]*?)\\\]/g;
const _LATEX_INLINE_P = /\\\(([\s\S]*?)\\\)/g;
function containsLatexSymbols(content) {
    if (content.length < 5)
        return false;
    return content.includes('\\') || content.includes('_') || content.includes('^');
}
export function escapeLatex(text) {
    const convert = (match, p1, isBlock) => {
        if (!containsLatexSymbols(p1))
            return match;
        const converted = _latexHelper.convert(p1);
        if (isBlock) {
            return `$$${converted.trim()}$$`;
        }
        else {
            return `$${converted.trim().replace(/^\n+|\n+$/g, '')}$`;
        }
    };
    const lines = text.split('\n\n');
    const processed = lines.map(line => {
        let l = line.replace(_LATEX_MATH_P, (m, p1) => convert(m, p1, true));
        l = l.replace(_LATEX_INLINE_P, (m, p1) => convert(m, p1, false));
        return l;
    });
    return processed.join('\n\n');
}
/** UTF-8 byte offsets of `$` and `~` delimiters that should read as plain text. */
function literalDelimiters(text, events) {
    if (!text.includes('$') && !text.includes('~'))
        return [];
    const source = Buffer.from(text, 'utf8');
    const offsets = [];
    for (const [event, range] of events) {
        if (typeof event !== 'object')
            continue;
        if ('Start' in event && event.Start === 'Strikethrough') {
            // Strikethrough takes `~~`; a single `~` reads as "approximately"
            if (source[range.start + 1] !== 0x7e)
                offsets.push(range.start, range.end - 1);
        }
        else if ('InlineMath' in event) {
            // A closing `$` directly followed by a digit means prices (pandoc's rule)
            const next = source[range.end];
            if (next !== undefined && next >= 0x30 && next <= 0x39)
                offsets.push(range.start, range.end - 1);
        }
    }
    return offsets;
}
/** Insert a backslash before each UTF-8 byte offset of `text`. */
function escapeAt(text, offsets) {
    const source = Buffer.from(text, 'utf8');
    const bounds = [0, ...offsets.sort((a, b) => a - b), source.length];
    const pieces = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
        pieces.push(source.toString('utf8', bounds[i], bounds[i + 1]));
    }
    return pieces.join('\\');
}
/**
 * Preprocess and parse Markdown; return the parsed text and its ranged events.
 * Ranges are UTF-8 byte offsets into the returned text.
 *
 * Inline math closed by a `$` that a digit follows (`$10.49 (~$11.20)`) and
 * single-tilde strikethrough are rarely what chat text means, so their
 * delimiters are escaped and the text parsed again until neither remains.
 */
export function parseMarkdown(markdown, options, latexEscape) {
    let text = latexEscape ? escapeLatex(markdown) : markdown;
    text = preprocessSpoilers(text, options);
    let events = parseEvents(text, options);
    let offsets;
    while ((offsets = literalDelimiters(text, events)).length > 0) {
        text = escapeAt(text, offsets);
        events = parseEvents(text, options);
    }
    return { text, events };
}
class TextBuffer {
    _parts = [];
    _utf16Offset = 0;
    write(text) {
        this._parts.push(text);
        this._utf16Offset += utf16Len(text);
    }
    get utf16Offset() { return this._utf16Offset; }
    // JS strings are UTF-16, so the string index and the UTF-16 offset coincide
    get pyOffset() { return this._utf16Offset; }
    trailingNewlineCount() {
        let count = 0;
        for (let i = this._parts.length - 1; i >= 0; i--) {
            const part = this._parts[i];
            for (let j = part.length - 1; j >= 0; j--) {
                if (part[j] === '\n')
                    count++;
                else
                    return count;
            }
        }
        return count;
    }
    popLast() {
        if (this._parts.length > 0) {
            const part = this._parts.pop();
            this._utf16Offset -= utf16Len(part);
            return part;
        }
        return '';
    }
    getText() {
        return this._parts.join('');
    }
}
const INLINE_HTML_ENTITIES = {
    'tg-spoiler': 'spoiler',
    u: 'underline', ins: 'underline',
    b: 'bold', strong: 'bold',
    i: 'italic', em: 'italic',
    s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
};
const HEADING_ENTITIES = {
    H1: ['bold', 'underline'],
    H2: ['bold', 'underline'],
    H3: ['bold'],
    H4: ['bold'],
    H5: ['italic'],
    H6: ['italic'],
};
export class EventWalker {
    _buf = new TextBuffer();
    _entityStack = [];
    _entities = [];
    _segments = [];
    _config;
    _sourceBytes;
    _blockCount = 0;
    _lastBlockStart = -1; // lower bound of the blank-line scan
    _listStack = [];
    _itemStarted = false;
    _itemIndent = '';
    _inTable = false;
    _tableAlignments = [];
    _tableRows = [];
    _currentRow = [];
    _cellParts = [];
    _inTableCell = false;
    _inCodeBlock = false;
    _codeBlockLang = '';
    _codeBlockParts = [];
    _codeBlockStartSource = null;
    _inHeading = false;
    _headingEntities = [];
    _blockquoteScopes = [];
    constructor(config, sourceMarkdown) {
        this._config = config;
        this._sourceBytes = Buffer.from(sourceMarkdown, 'utf8');
    }
    walk(events) {
        for (const [event, range] of events) {
            this.handleEvent(event, range);
        }
        const text = this._buf.getText();
        if (this._config.citeExpandable) {
            for (const ent of this._entities) {
                if (ent.type === 'blockquote' && ent.length > 200) {
                    ent.type = 'expandable_blockquote';
                }
            }
        }
        return { text, entities: this._entities, segments: this._segments };
    }
    handleEvent(event, sourceRange) {
        if (typeof event === 'string') {
            if (event === 'SoftBreak')
                this.onSoftBreak();
            else if (event === 'HardBreak')
                this.onHardBreak();
            else if (event === 'Rule')
                this.onRule(sourceRange);
            return;
        }
        if ('Start' in event)
            this.onStart(event.Start, sourceRange);
        else if ('End' in event)
            this.onEnd(event.End);
        else if ('Text' in event)
            this.onText(event.Text);
        else if ('Code' in event)
            this.onInlineCode(event.Code);
        else if ('InlineMath' in event)
            this.onInlineMath(event.InlineMath);
        else if ('DisplayMath' in event)
            this.onDisplayMath(event.DisplayMath, sourceRange);
        else if ('InlineHtml' in event)
            this.onInlineHtml(event.InlineHtml);
        else if ('Html' in event) { } // block HTML ignored
        else if ('TaskListMarker' in event)
            this.onTaskListMarker(event.TaskListMarker);
        else if ('FootnoteReference' in event)
            this.onText(`[${event.FootnoteReference}]`);
    }
    onStart(tag, sourceRange) {
        const start = sourceRange ? sourceRange.start : null;
        if (tag === 'Strong')
            this.pushEntity('bold');
        else if (tag === 'Emphasis')
            this.pushEntity('italic');
        else if (tag === 'Strikethrough')
            this.pushEntity('strikethrough');
        else if (tag === 'Paragraph')
            this.onStartParagraph(start);
        else if (tag === 'Item')
            this.onStartItem();
        else if (tag === 'TableHead' || tag === 'TableRow')
            this._currentRow = [];
        else if (tag === 'TableCell') {
            this._cellParts = [];
            this._inTableCell = true;
        }
        else if (tag === 'HtmlBlock') { }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag)
                this.onStartHeading(tag.Heading, start);
            else if ('CodeBlock' in tag)
                this.onStartCodeBlock(tag.CodeBlock, start);
            else if ('BlockQuote' in tag)
                this.onStartBlockQuote(start);
            else if ('Link' in tag)
                this.onStartLink(tag.Link);
            else if ('Image' in tag)
                this.onStartImage(tag.Image);
            else if ('List' in tag)
                this.onStartList(tag.List, start);
            else if ('Table' in tag)
                this.onStartTable(tag.Table, start);
            else if ('FootnoteDefinition' in tag)
                this.ensureBlockSpacing(start);
        }
    }
    onEnd(tag) {
        if (tag === 'Strong')
            this.popEntity('bold');
        else if (tag === 'Emphasis')
            this.popEntity('italic');
        else if (tag === 'Strikethrough')
            this.popEntity('strikethrough');
        else if (tag === 'Paragraph')
            this.onEndParagraph();
        else if (tag === 'Item')
            this.onEndItem();
        else if (tag === 'TableCell')
            this.onEndTableCell();
        else if (tag === 'TableRow' || tag === 'TableHead')
            this.onEndTableRow();
        else if (tag === 'Table')
            this.onEndTable();
        else if (tag === 'CodeBlock')
            this.onEndCodeBlock();
        else if (tag === 'Link')
            this.popEntity('text_link');
        else if (tag === 'Image')
            this.popEntityAny();
        else if (tag === 'FootnoteDefinition') { }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag)
                this.onEndHeading();
            else if ('BlockQuote' in tag)
                this.onEndBlockQuote();
            else if ('List' in tag)
                this.onEndList();
        }
    }
    onText(text) {
        if (this._inCodeBlock) {
            this._codeBlockParts.push(text);
            return;
        }
        if (this._inTableCell) {
            this._cellParts.push(text);
            return;
        }
        this._buf.write(text);
    }
    onSoftBreak() {
        if (this._inCodeBlock) {
            this._codeBlockParts.push('\n');
            return;
        }
        if (this._inTableCell) {
            this._cellParts.push(' ');
            return;
        }
        this._buf.write('\n');
    }
    onHardBreak() {
        if (this._inCodeBlock) {
            this._codeBlockParts.push('\n');
            return;
        }
        this._buf.write('\n');
    }
    onRule(sourceRange) {
        this.ensureBlockSpacing(sourceRange?.start ?? null);
        this._buf.write(this._config.markdownSymbol.horizontalRule);
        this.markBlockEnd();
    }
    onInlineCode(code) {
        if (this._inTableCell) {
            this._cellParts.push(code);
            return;
        }
        const start = this._buf.utf16Offset;
        this._buf.write(code);
        const len = this._buf.utf16Offset - start;
        if (len > 0) {
            this._entities.push({ type: 'code', offset: start, length: len });
        }
    }
    onInlineMath(math) {
        let converted = math;
        if (containsLatexSymbols(math)) {
            converted = _latexHelper.convert(math).trim().replace(/\n/g, '');
        }
        const start = this._buf.utf16Offset;
        this._buf.write(converted);
        const len = this._buf.utf16Offset - start;
        if (len > 0) {
            this._entities.push({ type: 'code', offset: start, length: len });
        }
    }
    onDisplayMath(math, sourceRange) {
        let converted = math;
        if (containsLatexSymbols(math)) {
            converted = _latexHelper.convert(math).trim();
        }
        this.ensureBlockSpacing(sourceRange?.start ?? null);
        const start = this._buf.utf16Offset;
        this._buf.write(converted);
        const len = this._buf.utf16Offset - start;
        if (len > 0) {
            this._entities.push({ type: 'pre', offset: start, length: len });
        }
        this.markBlockEnd();
    }
    onInlineHtml(html) {
        // Bare formatting tags, for what Markdown has no syntax for (underline)
        const match = /^<(\/?)([a-z][a-z0-9-]*)\s*>$/.exec(html.trim().toLowerCase());
        const entityType = match ? INLINE_HTML_ENTITIES[match[2]] : undefined;
        if (!entityType)
            return;
        if (match[1])
            this.popEntity(entityType);
        else
            this.pushEntity(entityType);
    }
    onTaskListMarker(checked) {
        const symbol = checked
            ? this._config.markdownSymbol.taskCompleted
            : this._config.markdownSymbol.taskUncompleted;
        this._buf.popLast();
        this._buf.write(`${this._itemIndent}${symbol} `);
    }
    onStartHeading(headingData, sourceStart) {
        this.ensureBlockSpacing(sourceStart);
        const level = headingData.level;
        const symbolMap = {
            H1: this._config.markdownSymbol.headingLevel1,
            H2: this._config.markdownSymbol.headingLevel2,
            H3: this._config.markdownSymbol.headingLevel3,
            H4: this._config.markdownSymbol.headingLevel4,
            H5: this._config.markdownSymbol.headingLevel5,
            H6: this._config.markdownSymbol.headingLevel6,
        };
        const prefix = symbolMap[level] || '';
        if (prefix)
            this._buf.write(prefix + ' ');
        this._headingEntities = HEADING_ENTITIES[level] || ['bold'];
        for (const etype of this._headingEntities) {
            this.pushEntity(etype);
        }
        this._inHeading = true;
    }
    onEndHeading() {
        for (let i = this._headingEntities.length - 1; i >= 0; i--) {
            this.popEntity(this._headingEntities[i]);
        }
        this._headingEntities = [];
        this._inHeading = false;
        this.markBlockEnd();
    }
    onStartParagraph(sourceStart) {
        if (this._listStack.length === 0) {
            this.ensureBlockSpacing(sourceStart);
        }
    }
    onEndParagraph() {
        if (this._listStack.length === 0) {
            this.markBlockEnd();
        }
        else if (this._buf.trailingNewlineCount() === 0) {
            this._buf.write('\n');
        }
    }
    onStartCodeBlock(kind, sourceStart) {
        this._inCodeBlock = true;
        this._codeBlockParts = [];
        this._codeBlockStartSource = sourceStart;
        if (typeof kind === 'object' && 'Fenced' in kind) {
            this._codeBlockLang = kind.Fenced;
        }
        else {
            this._codeBlockLang = '';
        }
    }
    onEndCodeBlock() {
        this._inCodeBlock = false;
        let rawCode = this._codeBlockParts.join('');
        if (rawCode.endsWith('\n')) {
            rawCode = rawCode.substring(0, rawCode.length - 1);
        }
        this.ensureBlockSpacing(this._codeBlockStartSource);
        const segTextStart = this._buf.pyOffset;
        const segUtf16Start = this._buf.utf16Offset;
        const start = this._buf.utf16Offset;
        this._buf.write(rawCode);
        const len = this._buf.utf16Offset - start;
        const lang = this._codeBlockLang ? this._codeBlockLang.split(',')[0].trim() : '';
        if (len > 0) {
            this._entities.push({
                type: 'pre',
                offset: start,
                length: len,
                language: lang ? lang : undefined,
            });
        }
        const segKind = lang.toLowerCase() === 'mermaid' ? 'mermaid' : 'code_block';
        this._segments.push({
            kind: segKind,
            textStart: segTextStart,
            textEnd: this._buf.pyOffset,
            utf16Start: segUtf16Start,
            utf16End: this._buf.utf16Offset,
            language: lang,
            rawCode,
        });
        this.markBlockEnd();
        this._codeBlockLang = '';
        this._codeBlockParts = [];
        this._codeBlockStartSource = null;
    }
    onStartBlockQuote(sourceStart) {
        this.ensureBlockSpacing(sourceStart);
        this._blockquoteScopes.push({
            entityType: 'blockquote',
            startOffset: this._buf.utf16Offset,
        });
    }
    onEndBlockQuote() {
        if (this._blockquoteScopes.length > 0) {
            const scope = this._blockquoteScopes.pop();
            const len = this._buf.utf16Offset - scope.startOffset;
            if (len > 0) {
                this._entities.push({
                    type: 'blockquote',
                    offset: scope.startOffset,
                    length: len,
                });
            }
        }
        this.markBlockEnd();
    }
    onStartLink(linkData) {
        const destUrl = linkData.dest_url || '';
        const emojiId = validateTelegramEmoji(destUrl);
        if (emojiId) {
            this.pushEntity('custom_emoji', { customEmojiId: emojiId });
        }
        else if (destUrl) {
            this.pushEntity('text_link', { url: destUrl });
        }
    }
    onStartImage(imageData) {
        const destUrl = imageData.dest_url || '';
        const emojiId = validateTelegramEmoji(destUrl);
        if (emojiId) {
            this.pushEntity('custom_emoji', { customEmojiId: emojiId });
        }
        else {
            // Through onText: inside a table cell the symbol belongs to the cell. The
            // entity is still pushed so End(Image) does not close an outer scope.
            this.onText(this._config.markdownSymbol.image);
            this.pushEntity('text_link', { url: destUrl });
        }
    }
    onStartList(startNumber, sourceStart) {
        if (this._listStack.length === 0) {
            this.ensureBlockSpacing(sourceStart);
        }
        this._listStack.push(startNumber);
    }
    onStartItem() {
        const depth = this._listStack.length;
        const indent = depth > 1 ? '  '.repeat(depth - 1) : '';
        const currentList = this._listStack.length > 0 ? this._listStack[this._listStack.length - 1] : null;
        if (this._buf.pyOffset > 0 && this._buf.trailingNewlineCount() === 0) {
            this._buf.write('\n');
        }
        this._itemIndent = indent;
        const symbols = this._config.markdownSymbol;
        if (currentList !== null) {
            this._buf.write(`${indent}${currentList}${symbols.orderedListSuffix} `);
            this._listStack[this._listStack.length - 1] = currentList + 1;
        }
        else {
            this._buf.write(`${indent}${symbols.unorderedListItem} `);
        }
        this._itemStarted = true;
    }
    onEndItem() {
        if (this._buf.trailingNewlineCount() === 0) {
            this._buf.write('\n');
        }
        this._itemStarted = false;
    }
    onEndList() {
        if (this._listStack.length > 0)
            this._listStack.pop();
        if (this._listStack.length === 0)
            this.markBlockEnd();
    }
    onStartTable(alignments, sourceStart) {
        this.ensureBlockSpacing(sourceStart);
        this._inTable = true;
        this._tableAlignments = Array.isArray(alignments) ? alignments : [];
        this._tableRows = [];
    }
    onEndTableCell() {
        this._currentRow.push(this._cellParts.join(''));
        this._cellParts = [];
        this._inTableCell = false;
    }
    onEndTableRow() {
        if (this._currentRow.length > 0) {
            this._tableRows.push(this._currentRow);
            this._currentRow = [];
        }
    }
    onEndTable() {
        this._inTable = false;
        const tableText = this.formatTable(this._tableRows);
        const start = this._buf.utf16Offset;
        this._buf.write(tableText);
        const len = this._buf.utf16Offset - start;
        if (len > 0) {
            this._entities.push({ type: 'pre', offset: start, length: len });
        }
        this._tableRows = [];
        this.markBlockEnd();
    }
    formatTable(rows) {
        if (rows.length === 0)
            return '';
        let numCols = 0;
        for (const r of rows) {
            if (r.length > numCols)
                numCols = r.length;
        }
        const colWidths = new Array(numCols).fill(0);
        for (const row of rows) {
            for (let i = 0; i < row.length; i++) {
                if (i < numCols) {
                    colWidths[i] = Math.max(colWidths[i], row[i].length);
                }
            }
        }
        const lines = [];
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            const cells = [];
            for (let i = 0; i < numCols; i++) {
                const cell = i < row.length ? row[i] : '';
                cells.push(cell.padEnd(colWidths[i], ' '));
            }
            lines.push(cells.join(' | '));
            if (rowIdx === 0 && rows.length > 1) {
                const sepCells = colWidths.map(w => '-'.repeat(w));
                lines.push(sepCells.join('-+-'));
            }
        }
        return lines.join('\n');
    }
    pushEntity(entityType, extra = {}) {
        this._entityStack.push({
            entityType,
            startOffset: this._buf.utf16Offset,
            ...extra,
        });
    }
    popEntity(entityType) {
        for (let i = this._entityStack.length - 1; i >= 0; i--) {
            if (this._entityStack[i].entityType === entityType) {
                const scope = this._entityStack.splice(i, 1)[0];
                this.finalizeEntity(scope);
                return;
            }
        }
    }
    popEntityAny() {
        if (this._entityStack.length > 0) {
            const scope = this._entityStack.pop();
            this.finalizeEntity(scope);
        }
    }
    finalizeEntity(scope) {
        const len = this._buf.utf16Offset - scope.startOffset;
        if (len <= 0)
            return;
        this._entities.push({
            type: scope.entityType,
            offset: scope.startOffset,
            length: len,
            url: scope.url,
            language: scope.language,
            custom_emoji_id: scope.customEmojiId,
            user: scope.user,
            unix_time: scope.unixTime,
            date_time_format: scope.dateTimeFormat,
        });
    }
    markBlockEnd() {
        this._blockCount++;
    }
    /**
     * Whether the source holds a blank line just before nextBlockStart (a UTF-8
     * byte offset). Scans back, skipping indentation and blockquote markers, and
     * stops at the previous block's start. Block end ranges cannot answer this:
     * a List range swallows the blank line after the list.
     */
    hasExtraBlankLine(nextBlockStart) {
        const src = this._sourceBytes;
        let newlines = 0;
        for (let i = nextBlockStart - 1; i > this._lastBlockStart; i--) {
            const ch = src[i];
            if (ch === 0x0d) {
                // Inside a CRLF the LF already counted; only a lone CR adds one
                if (src[i + 1] === 0x0a)
                    continue;
                newlines++;
            }
            else if (ch === 0x0a) {
                newlines++;
            }
            else if (ch === 0x20 || ch === 0x09 || ch === 0x3e) {
                continue;
            }
            else {
                return false;
            }
            if (newlines >= 2)
                return true;
        }
        return false;
    }
    ensureBlockSpacing(nextBlockStart = null) {
        if (this._blockCount > 0) {
            let desired = 1;
            if (nextBlockStart === null) {
                desired = 2;
            }
            else if (this.hasExtraBlankLine(nextBlockStart)) {
                desired = 2;
            }
            const trailing = this._buf.trailingNewlineCount();
            const needed = desired - trailing;
            if (needed > 0) {
                this._buf.write('\n'.repeat(needed));
            }
        }
        if (nextBlockStart !== null) {
            this._lastBlockStart = nextBlockStart;
        }
    }
}
export function convertWithSegments(markdown, options) {
    const latexEscape = options?.latexEscape ?? true;
    const config = options?.config ?? getRuntimeConfig();
    const { text, events } = parseMarkdown(markdown, STANDARD_OPTIONS, latexEscape);
    const walker = new EventWalker(config, text);
    return walker.walk(events);
}
export function convert(markdown, options) {
    const res = convertWithSegments(markdown, options);
    return { text: res.text, entities: res.entities };
}

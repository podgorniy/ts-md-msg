import * as md from '../native/index.js';
import { getRuntimeConfig } from './config.js';
import { utf16Len } from './entity.js';
import { LatexToUnicodeHelper } from './latex/helper.js';
const _latexHelper = new LatexToUnicodeHelper();
const _SPOILER_RE = /(?<![\\])\|\|([\s\S]+?)\|\|/g;
const _CODE_REGION_RE = /(```[\s\S]*?```|`[^`\n]+`)/;
export function preprocessSpoilers(text) {
    const parts = text.split(_CODE_REGION_RE);
    const result = [];
    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (i % 2 === 0) {
            part = part.replace(_SPOILER_RE, '<tg-spoiler>$1</tg-spoiler>');
        }
        result.push(part);
    }
    return result.join('');
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
            return `$${converted.trim().replace(/\n/g, '')}$`;
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
class TextBuffer {
    _parts = [];
    _utf16Offset = 0;
    write(text) {
        this._parts.push(text);
        this._utf16Offset += utf16Len(text);
    }
    get utf16Offset() { return this._utf16Offset; }
    get pyOffset() { return this._parts.join('').length; }
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
    _sourceMarkdown;
    _blockCount = 0;
    _lastBlockEndSource = null;
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
        this._sourceMarkdown = sourceMarkdown;
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
            this.onEnd(event.End, sourceRange);
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
    onEnd(tag, sourceRange) {
        const end = sourceRange ? sourceRange.end : null;
        if (tag === 'Strong')
            this.popEntity('bold');
        else if (tag === 'Emphasis')
            this.popEntity('italic');
        else if (tag === 'Strikethrough')
            this.popEntity('strikethrough');
        else if (tag === 'Paragraph')
            this.onEndParagraph(end);
        else if (tag === 'Item')
            this.onEndItem();
        else if (tag === 'TableCell')
            this.onEndTableCell();
        else if (tag === 'TableRow' || tag === 'TableHead')
            this.onEndTableRow();
        else if (tag === 'Table')
            this.onEndTable(end);
        else if (tag === 'CodeBlock')
            this.onEndCodeBlock(end);
        else if (tag === 'Link')
            this.popEntity('text_link');
        else if (tag === 'Image')
            this.popEntityAny();
        else if (tag === 'FootnoteDefinition') { }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag)
                this.onEndHeading(end);
            else if ('BlockQuote' in tag)
                this.onEndBlockQuote(end);
            else if ('List' in tag)
                this.onEndList(end);
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
        this.markBlockEnd(sourceRange?.end ?? null);
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
        this.markBlockEnd(sourceRange?.end ?? null);
    }
    onInlineHtml(html) {
        const tag = html.trim().toLowerCase();
        if (tag === '<tg-spoiler>')
            this.pushEntity('spoiler');
        else if (tag === '</tg-spoiler>')
            this.popEntity('spoiler');
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
    onEndHeading(sourceEnd) {
        for (let i = this._headingEntities.length - 1; i >= 0; i--) {
            this.popEntity(this._headingEntities[i]);
        }
        this._headingEntities = [];
        this._inHeading = false;
        this.markBlockEnd(sourceEnd);
    }
    onStartParagraph(sourceStart) {
        if (this._listStack.length === 0) {
            this.ensureBlockSpacing(sourceStart);
        }
    }
    onEndParagraph(sourceEnd) {
        if (this._listStack.length === 0) {
            this.markBlockEnd(sourceEnd);
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
    onEndCodeBlock(sourceEnd) {
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
        this.markBlockEnd(sourceEnd);
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
    onEndBlockQuote(sourceEnd) {
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
        this.markBlockEnd(sourceEnd);
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
            this._buf.write(this._config.markdownSymbol.image);
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
        if (currentList !== null) {
            this._buf.write(`${indent}${currentList}. `);
            this._listStack[this._listStack.length - 1] = currentList + 1;
        }
        else {
            this._buf.write(`${indent}⦁ `);
        }
        this._itemStarted = true;
    }
    onEndItem() {
        if (this._buf.trailingNewlineCount() === 0) {
            this._buf.write('\n');
        }
        this._itemStarted = false;
    }
    onEndList(sourceEnd) {
        if (this._listStack.length > 0)
            this._listStack.pop();
        if (this._listStack.length === 0)
            this.markBlockEnd(sourceEnd);
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
    onEndTable(sourceEnd) {
        this._inTable = false;
        const tableText = this.formatTable(this._tableRows);
        const start = this._buf.utf16Offset;
        this._buf.write(tableText);
        const len = this._buf.utf16Offset - start;
        if (len > 0) {
            this._entities.push({ type: 'pre', offset: start, length: len });
        }
        this._tableRows = [];
        this.markBlockEnd(sourceEnd);
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
    markBlockEnd(sourceEnd) {
        this._blockCount++;
        if (sourceEnd !== null) {
            this._lastBlockEndSource = sourceEnd;
        }
    }
    hasExtraBlankLine(nextBlockStart) {
        if (this._lastBlockEndSource === null)
            return false;
        if (nextBlockStart <= this._lastBlockEndSource)
            return false;
        const gap = this._sourceMarkdown.substring(this._lastBlockEndSource, nextBlockStart);
        return gap.includes('\n') || gap.includes('\r');
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
    }
}
export function convertWithSegments(markdown, options) {
    const latexEscape = options?.latexEscape ?? true;
    const config = options?.config ?? getRuntimeConfig();
    let preprocessed = markdown;
    if (latexEscape) {
        preprocessed = escapeLatex(preprocessed);
    }
    preprocessed = preprocessSpoilers(preprocessed);
    const rawEvents = JSON.parse(md.parse(preprocessed, {
        enableStrikethrough: true,
        enableTables: true,
        enableTasklists: true,
        enableMath: true,
        enableGfm: true,
        enableFootnotes: true
    }));
    const walker = new EventWalker(config, preprocessed);
    return walker.walk(rawEvents);
}
export function convert(markdown, options) {
    const res = convertWithSegments(markdown, options);
    return { text: res.text, entities: res.entities };
}

import * as md from '../native/index.js';
import { getRuntimeConfig, RenderConfig } from './config.js';
import { MessageEntity, utf16Len } from './entity.js';
import { Event, Range, Segment, Tag, TagEnd } from './types.js';
import { LatexToUnicodeHelper } from './latex/helper.js';

const _latexHelper = new LatexToUnicodeHelper();

export type ParseOptions = md.MarkdownOptions;

/** Parser options for the entity backend. */
export const STANDARD_OPTIONS: ParseOptions = {
  enableTables: true,
  enableStrikethrough: true,
  enableTasklists: true,
  enableMath: true,
  enableFootnotes: true,
};

function parseEvents(text: string, options: ParseOptions): [Event, Range][] {
  return JSON.parse(md.parse(text, options));
}

const _SPOILER_RE = /(?<![\\])\|\|([\s\S]+?)\|\|/g;

// A line break plus the blockquote markers that open the next line. Indentation
// alone stays with the text: in front of the tag it could start indented code.
const _LINE_BREAK = '(?:\\r\\n?|\\n)(?:[ \\t]*>[ \\t]?)*';
const _SPOILER_EDGES_RE = new RegExp(
  `^((?:[ \\t]*${_LINE_BREAK})*)([\\s\\S]*?)((?:${_LINE_BREAK}[ \\t]*)*)$`
);

/**
 * Wrap ||...|| in <tg-spoiler>, keeping the open tag off a line of its own.
 * CommonMark reads a line holding nothing but an open tag as an HTML block,
 * which the converter drops, so line breaks at either edge stay outside.
 */
function spoilerReplacement(match: string, body: string): string {
  const edges = _SPOILER_EDGES_RE.exec(body)!;
  const [, leading, inner, trailing] = edges;
  if (!inner) return match;
  return `${leading}<tg-spoiler>${inner}</tg-spoiler>${trailing}`;
}

/** UTF-8 byte ranges of the source the parser treats as code, in document order. */
function codeRegions(text: string, options: ParseOptions): [number, number][] {
  const regions: [number, number][] = [];
  for (const [event, range] of parseEvents(text, options)) {
    if (typeof event !== 'object') continue;
    const isCodeBlock = 'Start' in event && typeof event.Start === 'object' && 'CodeBlock' in event.Start;
    if (isCodeBlock || 'Code' in event) regions.push([range.start, range.end]);
  }
  return regions;
}

/**
 * Replace ||spoiler|| with <tg-spoiler>spoiler</tg-spoiler>, leaving fenced,
 * indented and inline code alone. `options` must match the ones the result is
 * parsed with: footnotes, for instance, change what counts as indented code.
 */
export function preprocessSpoilers(text: string, options: ParseOptions = STANDARD_OPTIONS): string {
  if (!text.includes('||')) return text;
  const data = Buffer.from(text, 'utf8');
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of codeRegions(text, options)) {
    parts.push(data.toString('utf8', cursor, start).replace(_SPOILER_RE, spoilerReplacement));
    parts.push(data.toString('utf8', start, end));
    cursor = end;
  }
  parts.push(data.toString('utf8', cursor).replace(_SPOILER_RE, spoilerReplacement));
  return parts.join('');
}

export function validateTelegramEmoji(url: string): string | null {
  if (!url.startsWith('tg://emoji?id=')) return null;
  const emojiId = url.replace('tg://emoji?id=', '');
  if (/^\d{19}$/.test(emojiId)) return emojiId;
  return null;
}

const _LATEX_MATH_P = /\\\[([\s\S]*?)\\\]/g;
const _LATEX_INLINE_P = /\\\(([\s\S]*?)\\\)/g;

function containsLatexSymbols(content: string): boolean {
  if (content.length < 5) return false;
  return content.includes('\\') || content.includes('_') || content.includes('^');
}

export function escapeLatex(text: string): string {
  const convert = (match: string, p1: string, isBlock: boolean) => {
    if (!containsLatexSymbols(p1)) return match;
    const converted = _latexHelper.convert(p1);
    if (isBlock) {
      return `$$${converted.trim()}$$`;
    } else {
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
function literalDelimiters(text: string, events: [Event, Range][]): number[] {
  if (!text.includes('$') && !text.includes('~')) return [];
  const source = Buffer.from(text, 'utf8');
  const offsets: number[] = [];
  for (const [event, range] of events) {
    if (typeof event !== 'object') continue;
    if ('Start' in event && event.Start === 'Strikethrough') {
      // Strikethrough takes `~~`; a single `~` reads as "approximately"
      if (source[range.start + 1] !== 0x7e) offsets.push(range.start, range.end - 1);
    } else if ('InlineMath' in event) {
      // A closing `$` directly followed by a digit means prices (pandoc's rule)
      const next = source[range.end];
      if (next !== undefined && next >= 0x30 && next <= 0x39) offsets.push(range.start, range.end - 1);
    }
  }
  return offsets;
}

/** Insert a backslash before each UTF-8 byte offset of `text`. */
function escapeAt(text: string, offsets: number[]): string {
  const source = Buffer.from(text, 'utf8');
  const bounds = [0, ...offsets.sort((a, b) => a - b), source.length];
  const pieces: string[] = [];
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
export function parseMarkdown(
  markdown: string,
  options: ParseOptions,
  latexEscape: boolean
): { text: string; events: [Event, Range][] } {
  let text = latexEscape ? escapeLatex(markdown) : markdown;
  text = preprocessSpoilers(text, options);
  let events = parseEvents(text, options);
  let offsets: number[];
  while ((offsets = literalDelimiters(text, events)).length > 0) {
    text = escapeAt(text, offsets);
    events = parseEvents(text, options);
  }
  return { text, events };
}

class TextBuffer {
  private _parts: string[] = [];
  private _utf16Offset: number = 0;

  write(text: string) {
    this._parts.push(text);
    this._utf16Offset += utf16Len(text);
  }

  get utf16Offset() { return this._utf16Offset; }
  // JS strings are UTF-16, so the string index and the UTF-16 offset coincide
  get pyOffset() { return this._utf16Offset; }

  trailingNewlineCount(): number {
    let count = 0;
    for (let i = this._parts.length - 1; i >= 0; i--) {
      const part = this._parts[i];
      for (let j = part.length - 1; j >= 0; j--) {
        if (part[j] === '\n') count++;
        else return count;
      }
    }
    return count;
  }

  popLast(): string {
    if (this._parts.length > 0) {
      const part = this._parts.pop()!;
      this._utf16Offset -= utf16Len(part);
      return part;
    }
    return '';
  }

  getText(): string {
    return this._parts.join('');
  }
}

interface EntityScope {
  entityType: string;
  startOffset: number;
  url?: string;
  language?: string;
  customEmojiId?: string;
  user?: any;
  unixTime?: number;
  dateTimeFormat?: string;
}

const INLINE_HTML_ENTITIES: Record<string, string> = {
  'tg-spoiler': 'spoiler',
  u: 'underline', ins: 'underline',
  b: 'bold', strong: 'bold',
  i: 'italic', em: 'italic',
  s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
};

const HEADING_ENTITIES: Record<string, string[]> = {
  H1: ['bold', 'underline'],
  H2: ['bold', 'underline'],
  H3: ['bold'],
  H4: ['bold'],
  H5: ['italic'],
  H6: ['italic'],
};

export class EventWalker {
  private _buf = new TextBuffer();
  private _entityStack: EntityScope[] = [];
  private _entities: MessageEntity[] = [];
  private _segments: Segment[] = [];
  private _config: RenderConfig;
  private _sourceBytes: Buffer;

  private _blockCount = 0;
  private _lastBlockStart = -1; // lower bound of the blank-line scan
  private _listStack: (number | null)[] = [];
  private _itemStarted = false;
  private _itemIndent = '';

  private _inTable = false;
  private _tableAlignments: any[] = [];
  private _tableRows: string[][] = [];
  private _currentRow: string[] = [];
  private _cellParts: string[] = [];
  private _inTableCell = false;

  private _inCodeBlock = false;
  private _codeBlockLang = '';
  private _codeBlockParts: string[] = [];
  private _codeBlockStartSource: number | null = null;

  private _inHeading = false;
  private _headingEntities: string[] = [];
  private _blockquoteScopes: EntityScope[] = [];

  constructor(config: RenderConfig, sourceMarkdown: string) {
    this._config = config;
    this._sourceBytes = Buffer.from(sourceMarkdown, 'utf8');
  }

  walk(events: [Event, Range][]): { text: string; entities: MessageEntity[]; segments: Segment[] } {
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

  private handleEvent(event: Event, sourceRange: Range | null) {
    if (typeof event === 'string') {
      if (event === 'SoftBreak') this.onSoftBreak();
      else if (event === 'HardBreak') this.onHardBreak();
      else if (event === 'Rule') this.onRule(sourceRange);
      return;
    }

    if ('Start' in event) this.onStart(event.Start, sourceRange);
    else if ('End' in event) this.onEnd(event.End);
    else if ('Text' in event) this.onText(event.Text);
    else if ('Code' in event) this.onInlineCode(event.Code);
    else if ('InlineMath' in event) this.onInlineMath(event.InlineMath);
    else if ('DisplayMath' in event) this.onDisplayMath(event.DisplayMath, sourceRange);
    else if ('InlineHtml' in event) this.onInlineHtml(event.InlineHtml);
    else if ('Html' in event) {} // block HTML ignored
    else if ('TaskListMarker' in event) this.onTaskListMarker(event.TaskListMarker);
    else if ('FootnoteReference' in event) this.onText(`[${event.FootnoteReference}]`);
  }

  private onStart(tag: Tag, sourceRange: Range | null) {
    const start = sourceRange ? sourceRange.start : null;
    if (tag === 'Strong') this.pushEntity('bold');
    else if (tag === 'Emphasis') this.pushEntity('italic');
    else if (tag === 'Strikethrough') this.pushEntity('strikethrough');
    else if (tag === 'Paragraph') this.onStartParagraph(start);
    else if (tag === 'Item') this.onStartItem();
    else if (tag === 'TableHead' || tag === 'TableRow') this._currentRow = [];
    else if (tag === 'TableCell') {
      this._cellParts = [];
      this._inTableCell = true;
    }
    else if (tag === 'HtmlBlock') {}
    else if (typeof tag === 'object' && tag !== null) {
      if ('Heading' in tag) this.onStartHeading(tag.Heading, start);
      else if ('CodeBlock' in tag) this.onStartCodeBlock(tag.CodeBlock, start);
      else if ('BlockQuote' in tag) this.onStartBlockQuote(start);
      else if ('Link' in tag) this.onStartLink(tag.Link);
      else if ('Image' in tag) this.onStartImage(tag.Image);
      else if ('List' in tag) this.onStartList(tag.List, start);
      else if ('Table' in tag) this.onStartTable(tag.Table, start);
      else if ('FootnoteDefinition' in tag) this.ensureBlockSpacing(start);
    }
  }

  private onEnd(tag: TagEnd) {
    if (tag === 'Strong') this.popEntity('bold');
    else if (tag === 'Emphasis') this.popEntity('italic');
    else if (tag === 'Strikethrough') this.popEntity('strikethrough');
    else if (tag === 'Paragraph') this.onEndParagraph();
    else if (tag === 'Item') this.onEndItem();
    else if (tag === 'TableCell') this.onEndTableCell();
    else if (tag === 'TableRow' || tag === 'TableHead') this.onEndTableRow();
    else if (tag === 'Table') this.onEndTable();
    else if (tag === 'CodeBlock') this.onEndCodeBlock();
    else if (tag === 'Link') this.popEntity('text_link');
    else if (tag === 'Image') this.popEntityAny();
    else if (tag === 'FootnoteDefinition') {}
    else if (typeof tag === 'object' && tag !== null) {
      if ('Heading' in tag) this.onEndHeading();
      else if ('BlockQuote' in tag) this.onEndBlockQuote();
      else if ('List' in tag) this.onEndList();
    }
  }

  private onText(text: string) {
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

  private onSoftBreak() {
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

  private onHardBreak() {
    if (this._inCodeBlock) {
      this._codeBlockParts.push('\n');
      return;
    }
    this._buf.write('\n');
  }

  private onRule(sourceRange: Range | null) {
    this.ensureBlockSpacing(sourceRange?.start ?? null);
    this._buf.write(this._config.markdownSymbol.horizontalRule);
    this.markBlockEnd();
  }

  private onInlineCode(code: string) {
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

  private onInlineMath(math: string) {
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

  private onDisplayMath(math: string, sourceRange: Range | null) {
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

  private onInlineHtml(html: string) {
    // Bare formatting tags, for what Markdown has no syntax for (underline)
    const match = /^<(\/?)([a-z][a-z0-9-]*)\s*>$/.exec(html.trim().toLowerCase());
    const entityType = match ? INLINE_HTML_ENTITIES[match[2]] : undefined;
    if (!entityType) return;
    if (match![1]) this.popEntity(entityType);
    else this.pushEntity(entityType);
  }

  private onTaskListMarker(checked: boolean) {
    const symbol = checked
      ? this._config.markdownSymbol.taskCompleted
      : this._config.markdownSymbol.taskUncompleted;
    this._buf.popLast();
    this._buf.write(`${this._itemIndent}${symbol} `);
  }

  private onStartHeading(headingData: any, sourceStart: number | null) {
    this.ensureBlockSpacing(sourceStart);
    const level = headingData.level as string;
    const symbolMap: Record<string, string> = {
      H1: this._config.markdownSymbol.headingLevel1,
      H2: this._config.markdownSymbol.headingLevel2,
      H3: this._config.markdownSymbol.headingLevel3,
      H4: this._config.markdownSymbol.headingLevel4,
      H5: this._config.markdownSymbol.headingLevel5,
      H6: this._config.markdownSymbol.headingLevel6,
    };
    const prefix = symbolMap[level] || '';
    if (prefix) this._buf.write(prefix + ' ');
    this._headingEntities = HEADING_ENTITIES[level] || ['bold'];
    for (const etype of this._headingEntities) {
      this.pushEntity(etype);
    }
    this._inHeading = true;
  }

  private onEndHeading() {
    for (let i = this._headingEntities.length - 1; i >= 0; i--) {
      this.popEntity(this._headingEntities[i]);
    }
    this._headingEntities = [];
    this._inHeading = false;
    this.markBlockEnd();
  }

  private onStartParagraph(sourceStart: number | null) {
    if (this._listStack.length === 0) {
      this.ensureBlockSpacing(sourceStart);
    }
  }

  private onEndParagraph() {
    if (this._listStack.length === 0) {
      this.markBlockEnd();
    } else if (this._buf.trailingNewlineCount() === 0) {
      this._buf.write('\n');
    }
  }

  private onStartCodeBlock(kind: any, sourceStart: number | null) {
    this._inCodeBlock = true;
    this._codeBlockParts = [];
    this._codeBlockStartSource = sourceStart;
    if (typeof kind === 'object' && 'Fenced' in kind) {
      this._codeBlockLang = kind.Fenced;
    } else {
      this._codeBlockLang = '';
    }
  }

  private onEndCodeBlock() {
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

  private onStartBlockQuote(sourceStart: number | null) {
    this.ensureBlockSpacing(sourceStart);
    this._blockquoteScopes.push({
      entityType: 'blockquote',
      startOffset: this._buf.utf16Offset,
    });
  }

  private onEndBlockQuote() {
    if (this._blockquoteScopes.length > 0) {
      const scope = this._blockquoteScopes.pop()!;
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

  private onStartLink(linkData: any) {
    const destUrl = linkData.dest_url || '';
    const emojiId = validateTelegramEmoji(destUrl);
    if (emojiId) {
      this.pushEntity('custom_emoji', { customEmojiId: emojiId });
    } else if (destUrl) {
      this.pushEntity('text_link', { url: destUrl });
    }
  }

  private onStartImage(imageData: any) {
    const destUrl = imageData.dest_url || '';
    const emojiId = validateTelegramEmoji(destUrl);
    if (emojiId) {
      this.pushEntity('custom_emoji', { customEmojiId: emojiId });
    } else {
      // Through onText: inside a table cell the symbol belongs to the cell. The
      // entity is still pushed so End(Image) does not close an outer scope.
      this.onText(this._config.markdownSymbol.image);
      this.pushEntity('text_link', { url: destUrl });
    }
  }

  private onStartList(startNumber: number | null, sourceStart: number | null) {
    if (this._listStack.length === 0) {
      this.ensureBlockSpacing(sourceStart);
    }
    this._listStack.push(startNumber);
  }

  private onStartItem() {
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
    } else {
      this._buf.write(`${indent}${symbols.unorderedListItem} `);
    }
    this._itemStarted = true;
  }

  private onEndItem() {
    if (this._buf.trailingNewlineCount() === 0) {
      this._buf.write('\n');
    }
    this._itemStarted = false;
  }

  private onEndList() {
    if (this._listStack.length > 0) this._listStack.pop();
    if (this._listStack.length === 0) this.markBlockEnd();
  }

  private onStartTable(alignments: any[], sourceStart: number | null) {
    this.ensureBlockSpacing(sourceStart);
    this._inTable = true;
    this._tableAlignments = Array.isArray(alignments) ? alignments : [];
    this._tableRows = [];
  }

  private onEndTableCell() {
    this._currentRow.push(this._cellParts.join(''));
    this._cellParts = [];
    this._inTableCell = false;
  }

  private onEndTableRow() {
    if (this._currentRow.length > 0) {
        this._tableRows.push(this._currentRow);
        this._currentRow = [];
    }
  }

  private onEndTable() {
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

  private formatTable(rows: string[][]): string {
    if (rows.length === 0) return '';
    let numCols = 0;
    for (const r of rows) {
      if (r.length > numCols) numCols = r.length;
    }
    const colWidths = new Array(numCols).fill(0);
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        if (i < numCols) {
          colWidths[i] = Math.max(colWidths[i], row[i].length);
        }
      }
    }

    const lines: string[] = [];
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const cells: string[] = [];
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

  private pushEntity(entityType: string, extra: Partial<EntityScope> = {}) {
    this._entityStack.push({
      entityType,
      startOffset: this._buf.utf16Offset,
      ...extra,
    });
  }

  private popEntity(entityType: string) {
    for (let i = this._entityStack.length - 1; i >= 0; i--) {
      if (this._entityStack[i].entityType === entityType) {
        const scope = this._entityStack.splice(i, 1)[0];
        this.finalizeEntity(scope);
        return;
      }
    }
  }

  private popEntityAny() {
    if (this._entityStack.length > 0) {
      const scope = this._entityStack.pop()!;
      this.finalizeEntity(scope);
    }
  }

  private finalizeEntity(scope: EntityScope) {
    const len = this._buf.utf16Offset - scope.startOffset;
    if (len <= 0) return;
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

  private markBlockEnd() {
    this._blockCount++;
  }

  /**
   * Whether the source holds a blank line just before nextBlockStart (a UTF-8
   * byte offset). Scans back, skipping indentation and blockquote markers, and
   * stops at the previous block's start. Block end ranges cannot answer this:
   * a List range swallows the blank line after the list.
   */
  private hasExtraBlankLine(nextBlockStart: number): boolean {
    const src = this._sourceBytes;
    let newlines = 0;
    for (let i = nextBlockStart - 1; i > this._lastBlockStart; i--) {
      const ch = src[i];
      if (ch === 0x0d) {
        // Inside a CRLF the LF already counted; only a lone CR adds one
        if (src[i + 1] === 0x0a) continue;
        newlines++;
      } else if (ch === 0x0a) {
        newlines++;
      } else if (ch === 0x20 || ch === 0x09 || ch === 0x3e) {
        continue;
      } else {
        return false;
      }
      if (newlines >= 2) return true;
    }
    return false;
  }

  private ensureBlockSpacing(nextBlockStart: number | null = null) {
    if (this._blockCount > 0) {
      let desired = 1;
      if (nextBlockStart === null) {
        desired = 2;
      } else if (this.hasExtraBlankLine(nextBlockStart)) {
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

export function convertWithSegments(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig }
): { text: string; entities: MessageEntity[]; segments: Segment[] } {
  const latexEscape = options?.latexEscape ?? true;
  const config = options?.config ?? getRuntimeConfig();

  const { text, events } = parseMarkdown(markdown, STANDARD_OPTIONS, latexEscape);
  const walker = new EventWalker(config, text);
  return walker.walk(events);
}

export function convert(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig }
): { text: string; entities: MessageEntity[] } {
  const res = convertWithSegments(markdown, options);
  return { text: res.text, entities: res.entities };
}

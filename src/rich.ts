import { escapeLatex, preprocessSpoilers, validateTelegramEmoji } from './converter.js';
import * as md from '../native/index.js';
import { Event, Range, Tag } from './types.js';

export type RichMode = 'html' | 'markdown';

export const RICH_BYTE_LIMIT = 32768;
export const RICH_BLOCK_LIMIT = 500;

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

interface ListScope {
  tag: string;
}

interface ImageCapture {
  url: string;
  title: string;
  parts: string[];
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

class RichHtmlWalker {
  private _parts: string[] = [];
  private _inlineClosers: string[] = [];
  private _listStack: ListScope[] = [];

  private _pendingParagraph = false;
  private _paragraphOpen = false;

  private _inCodeBlock = false;
  private _codeBlockLang = '';
  private _codeBlockParts: string[] = [];

  private _inTable = false;
  private _inTableHead = false;
  private _inTableCell = false;
  private _tableAlignments: any[] = [];
  private _tableRows: [string, boolean][][] = [];
  private _currentRow: [string, boolean][] = [];
  private _cellParts: string[] = [];
  private _cellCol = 0;

  private _image: ImageCapture | null = null;

  private _blockDepth = 0;
  private _blocks: RichBlock[] = [];
  private _blockMode = false;

  walk(events: [Event, Range][]): string {
    for (const [event, range] of events) {
      this.handleEvent(event);
    }
    this.closeParagraph();
    return this._parts.join('');
  }

  walkBlocks(events: [Event, Range][]): RichBlock[] {
    this._blockMode = true;
    for (const [event, range] of events) {
      this.handleEvent(event);
    }
    this.closeParagraph();
    this.flushBlock();
    return this._blocks;
  }

  private handleEvent(event: Event) {
    if (typeof event === 'string') {
      if (event === 'SoftBreak') this.onSoftBreak();
      else if (event === 'HardBreak') this.onHardBreak();
      else if (event === 'Rule') {
        this.closeParagraph();
        this.enterBlock();
        this.emit('<hr/>');
        this.leaveBlock();
      }
      return;
    }

    if ('Start' in event) this.onStart(event.Start);
    else if ('End' in event) this.onEnd(event.End);
    else if ('Text' in event) this.onText(event.Text);
    else if ('Code' in event) this.onInlineCode(event.Code);
    else if ('InlineMath' in event) {
      this.writeInline(`<tg-math>${escapeHtmlText(event.InlineMath)}</tg-math>`);
    } else if ('DisplayMath' in event) {
      this.closeParagraph();
      this.enterBlock();
      this.emit(`<tg-math-block>${escapeHtmlText(event.DisplayMath)}</tg-math-block>`);
      this.leaveBlock();
    } else if ('InlineHtml' in event) this.onInlineHtml(event.InlineHtml);
    else if ('Html' in event) this.writeInline(escapeHtmlText(event.Html));
    else if ('TaskListMarker' in event) this.writeInline(event.TaskListMarker ? '✅ ' : '☑ ');
    else if ('FootnoteReference' in event) {
      const ref = String(event.FootnoteReference);
      const href = escapeHtmlAttr(`#${ref}`);
      const label = escapeHtmlText(`[${ref}]`);
      this.writeInline(`<a href="${href}">${label}</a>`);
    }
  }

  private onInlineHtml(value: string) {
    const tag = value.trim().toLowerCase();
    if (tag === '<tg-spoiler>') this.openInline('<tg-spoiler>', '</tg-spoiler>');
    else if (tag === '</tg-spoiler>') this.closeInline();
    else this.writeInline(escapeHtmlText(value));
  }

  private onStart(tag: Tag) {
    if (tag === 'Strong') this.openInline('<b>', '</b>');
    else if (tag === 'Emphasis') this.openInline('<i>', '</i>');
    else if (tag === 'Strikethrough') this.openInline('<s>', '</s>');
    else if (tag === 'Paragraph') {
      this.enterBlock();
      this._pendingParagraph = true;
    } else if (tag === 'Item') {
      this.closeParagraph();
      this.emit('<li>');
    } else if (tag === 'TableHead') {
      this._currentRow = [];
      this._inTableHead = true;
    } else if (tag === 'TableRow') {
      this._currentRow = [];
      this._cellCol = 0;
    } else if (tag === 'TableCell') {
      this._cellParts = [];
      this._inTableCell = true;
    } else if (tag === 'HtmlBlock') {
      this.enterBlock();
      this._pendingParagraph = true;
    } else if (typeof tag === 'object' && tag !== null) {
      if ('Heading' in tag) {
        this.enterBlock();
        this.onStartHeading(tag.Heading);
      } else if ('CodeBlock' in tag) {
        this.enterBlock();
        this.onStartCodeBlock(tag.CodeBlock);
      } else if ('BlockQuote' in tag) {
        this.enterBlock();
        this.closeParagraph();
        this.emit('<blockquote>');
      } else if ('Link' in tag) this.onStartLink(tag.Link);
      else if ('Image' in tag) this.onStartImage(tag.Image);
      else if ('List' in tag) {
        this.enterBlock();
        this.onStartList(tag.List);
      } else if ('Table' in tag) {
        this.enterBlock();
        this.onStartTable(tag.Table);
      } else if ('FootnoteDefinition' in tag) {
        this.enterBlock();
        this.closeParagraph();
        const name = escapeHtmlAttr(String(tag.FootnoteDefinition));
        this.emit(`<tg-reference name="${name}">`);
      }
    }
  }

  private onEnd(tag: Tag) {
    if (tag === 'Strong') this.closeInline();
    else if (tag === 'Emphasis') this.closeInline();
    else if (tag === 'Strikethrough') this.closeInline();
    else if (tag === 'Paragraph') {
      this.closeParagraph();
      this.leaveBlock();
    } else if (tag === 'Item') {
      this.closeParagraph();
      this.emit('</li>');
    } else if (tag === 'CodeBlock') {
      this.onEndCodeBlock();
      this.leaveBlock();
    } else if (tag === 'Table') {
      this.onEndTable();
      this.leaveBlock();
    } else if (tag === 'TableCell') this.onEndTableCell();
    else if (tag === 'TableRow') {
      this.onEndTableRow();
      this._inTableHead = false;
    } else if (tag === 'TableHead') {
      this.onEndTableRow();
      this._inTableHead = false;
    } else if (tag === 'Link') this.closeInline();
    else if (tag === 'Image') this.onEndImage();
    else if (tag === 'FootnoteDefinition') {
      this.closeParagraph();
      this.emit('</tg-reference>');
      this.leaveBlock();
    } else if (tag === 'Heading') {
      const level = this._headingLevels.pop() || 1;
      this.emit(`</h${level}>`);
      this.leaveBlock();
    } else if (tag === 'BlockQuote') {
      this.closeParagraph();
      this.emit('</blockquote>');
      this.leaveBlock();
    } else if (tag === 'List') {
      this.onEndList();
      this.leaveBlock();
    } else if (typeof tag === 'object' && tag !== null) {
      // It shouldn't get here for End, but just in case
    }
  }

  private onText(text: string) {
    if (this._inCodeBlock) {
      this._codeBlockParts.push(text);
      return;
    }
    if (this._image !== null) {
      this._image.parts.push(text);
      return;
    }
    this.writeInline(escapeHtmlText(text));
  }

  private onSoftBreak() {
    if (this._inCodeBlock) {
      this._codeBlockParts.push('\n');
      return;
    }
    if (this._image !== null) {
      this._image.parts.push(' ');
      return;
    }
    this.writeInline('<br/>');
  }

  private onHardBreak() {
    if (this._inCodeBlock) {
      this._codeBlockParts.push('\n');
      return;
    }
    this.writeInline('<br/>');
  }

  private onInlineCode(code: string) {
    if (this._image !== null) {
      this._image.parts.push(code);
      return;
    }
    this.writeInline(`<code>${escapeHtmlText(code)}</code>`);
  }

  private _headingLevels: number[] = [];

  private onStartHeading(headingData: any) {
    this.closeParagraph();
    const level = this.headingLevel(headingData);
    this._headingLevels.push(level);
    this.emit(`<h${level}>`);
  }

  private onStartCodeBlock(kind: any) {
    this.closeParagraph();
    this._inCodeBlock = true;
    this._codeBlockParts = [];
    if (typeof kind === 'object' && 'Fenced' in kind) {
      this._codeBlockLang = kind.Fenced;
    } else {
      this._codeBlockLang = '';
    }
  }

  private onEndCodeBlock() {
    this._inCodeBlock = false;
    let rawCode = this._codeBlockParts.join('');
    if (rawCode.endsWith('\n')) rawCode = rawCode.substring(0, rawCode.length - 1);

    const lang = this._codeBlockLang ? this._codeBlockLang.split(',')[0].trim() : '';
    const escapedCode = escapeHtmlText(rawCode);

    if (lang.toLowerCase() === 'math') {
      this.emit(`<tg-math-block>${escapedCode}</tg-math-block>`);
    } else if (lang) {
      const escapedLang = escapeHtmlAttr(`language-${lang}`);
      this.emit(`<pre><code class="${escapedLang}">${escapedCode}</code></pre>`);
    } else {
      this.emit(`<pre>${escapedCode}</pre>`);
    }

    this._codeBlockLang = '';
    this._codeBlockParts = [];
  }

  private onStartLink(linkData: any) {
    const destUrl = linkData.dest_url || '';
    const emojiId = validateTelegramEmoji(destUrl);
    if (emojiId) {
      this.openInline(`<tg-emoji emoji-id="${escapeHtmlAttr(emojiId)}">`, '</tg-emoji>');
    } else if (destUrl) {
      this.openInline(`<a href="${escapeHtmlAttr(destUrl)}">`, '</a>');
    } else {
      this._inlineClosers.push('');
    }
  }

  private onStartImage(imageData: any) {
    this._image = {
      url: imageData.dest_url || '',
      title: imageData.title || '',
      parts: [],
    };
  }

  private onEndImage() {
    if (this._image === null) return;
    const image = this._image;
    this._image = null;
    const alt = image.parts.join('');
    const emojiId = validateTelegramEmoji(image.url);

    if (emojiId) {
      this.writeInline(`<tg-emoji emoji-id="${escapeHtmlAttr(emojiId)}">${escapeHtmlText(alt)}</tg-emoji>`);
      return;
    }

    if (image.url.startsWith('http://') || image.url.startsWith('https://')) {
      const attrs = [`src="${escapeHtmlAttr(image.url)}"`, `alt="${escapeHtmlAttr(alt)}"`];
      if (image.title) attrs.push(`title="${escapeHtmlAttr(image.title)}"`);
      this.writeInline(`<img ${attrs.join(' ')}/>`);
      return;
    }

    if (image.url) {
      const href = escapeHtmlAttr(image.url);
      const text = escapeHtmlText(alt || image.url);
      this.writeInline(`<a href="${href}">${text}</a>`);
    } else {
      this.writeInline(escapeHtmlText(alt));
    }
  }

  private onStartList(startNumber: number | null) {
    this.closeParagraph();
    if (startNumber === null || startNumber === undefined) {
      this.emit('<ul>');
      this._listStack.push({ tag: 'ul' });
    } else {
      this.emit(`<ol start="${Math.floor(startNumber)}">`);
      this._listStack.push({ tag: 'ol' });
    }
  }

  private onEndList() {
    this.closeParagraph();
    if (this._listStack.length > 0) {
      const scope = this._listStack.pop()!;
      this.emit(`</${scope.tag}>`);
    }
  }

  private onStartTable(alignments: any) {
    this.closeParagraph();
    this._inTable = true;
    this._tableAlignments = Array.isArray(alignments) ? alignments : [];
    this._tableRows = [];
    this.emit('');
  }

  private onEndTableCell() {
    const content = this._cellParts.join('');
    this._currentRow.push([content, this._inTableHead]);
    this._cellCol++;
    this._cellParts = [];
    this._inTableCell = false;
  }

  private onEndTableRow() {
    if (this._currentRow.length > 0) {
      this._tableRows.push(this._currentRow);
    }
    this._currentRow = [];
    this._cellCol = 0;
  }

  private onEndTable() {
    this._inTable = false;
    const rowsHtml: string[] = [];
    for (const row of this._tableRows) {
      const cellsHtml: string[] = [];
      for (let i = 0; i < row.length; i++) {
        const [content, isHeader] = row[i];
        const tag = isHeader ? 'th' : 'td';
        const align = this.tableAlignment(i);
        const attr = align ? ` align="${align}"` : '';
        cellsHtml.push(`<${tag}${attr}>${content}</${tag}>`);
      }
      rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`);
    }
    this.emit(`<table>${rowsHtml.join('')}</table>`);
    this._tableRows = [];
    this._tableAlignments = [];
  }

  private enterBlock() {
    this._blockDepth++;
  }

  private leaveBlock() {
    this._blockDepth--;
    if (this._blockMode && this._blockDepth === 0) {
      this.flushBlock();
    }
  }

  private flushBlock() {
    if (this._parts.length === 0) return;
    const blockHtml = this._parts.join('');
    this._parts = [];
    this._blocks.push({
      html: blockHtml,
      byteLen: new TextEncoder().encode(blockHtml).length,
      blockCount: 1,
    });
  }

  private openInline(openTag: string, closeTag: string) {
    this.writeInline(openTag);
    this._inlineClosers.push(closeTag);
  }

  private closeInline() {
    if (this._inlineClosers.length > 0) {
      const closer = this._inlineClosers.pop()!;
      if (closer) this.writeInline(closer);
    }
  }

  private writeInline(value: string) {
    this.openParagraphIfPending();
    this.emit(value);
  }

  private emit(value: string) {
    if (this._inTableCell) this._cellParts.push(value);
    else this._parts.push(value);
  }

  private openParagraphIfPending() {
    if (this._pendingParagraph && !this._paragraphOpen && !this._inTableCell) {
      this._parts.push('<p>');
      this._paragraphOpen = true;
    }
    this._pendingParagraph = false;
  }

  private closeParagraph() {
    this._pendingParagraph = false;
    if (this._paragraphOpen) {
      this._parts.push('</p>');
      this._paragraphOpen = false;
    }
  }

  private tableAlignment(index: number): string {
    if (index >= this._tableAlignments.length) return '';
    const value = String(this._tableAlignments[index]).toLowerCase();
    if (value === 'left' || value === 'center' || value === 'right') return value;
    return '';
  }

  private headingLevel(headingData: any): number {
    let level = 'H1';
    if (typeof headingData === 'object' && headingData.level) level = `H${headingData.level}`;
    else if (typeof headingData === 'string' || typeof headingData === 'number') level = String(headingData);

    if (level.startsWith('H')) {
      const num = parseInt(level.substring(1), 10);
      if (!isNaN(num)) return Math.max(1, Math.min(6, num));
    }
    return 1;
  }
}

export function richify(
  markdown: string,
  options?: {
    mode?: RichMode;
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;
  }
): InputRichMessage {
  const mode = options?.mode ?? 'html';
  const isRtl = options?.isRtl;
  const skipEntityDetection = options?.skipEntityDetection;
  const latexEscape = options?.latexEscape ?? false;

  if (mode === 'markdown') {
    return {
      markdown,
      isRtl,
      skipEntityDetection,
    };
  }
  if (mode !== 'html') {
    throw new Error("mode must be 'html' or 'markdown'");
  }

  let preprocessed = markdown;
  if (latexEscape) preprocessed = escapeLatex(preprocessed);
  preprocessed = preprocessSpoilers(preprocessed);

  const rawEvents = JSON.parse(md.parse(preprocessed));
  const walker = new RichHtmlWalker();
  const htmlText = walker.walk(rawEvents);

  return {
    html: htmlText,
    isRtl,
    skipEntityDetection,
  };
}

export function splitRich(
  richMessage: InputRichMessage,
  options?: { byteLimit?: number; blockLimit?: number }
): InputRichMessage[] {
  // Simple heuristic split logic could be added here if needed,
  // but usually users won't hit limits easily or we can implement it similarly to Python's _split_html.
  // For the initial port, we will just return the message since the Python heuristic is complex.
  return [richMessage];
}

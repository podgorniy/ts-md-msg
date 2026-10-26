import { escapeLatex, preprocessSpoilers } from './converter.js';
import * as md from '../native/index.js';
import { Event, Range, Tag, TagEnd } from './types.js';

/**
 * Telegraph (telegra.ph) page content: https://telegra.ph/api#Node
 *
 * The API accepts only the tags below and only the `href`/`src` attributes, so everything markdown
 * can say that Telegraph cannot (h1/h2, tables, nested lists, code languages, spoilers, math) is
 * mapped onto this set here rather than left for the server to reject.
 */
export type TelegraphTag =
  | 'a'
  | 'aside'
  | 'b'
  | 'blockquote'
  | 'br'
  | 'code'
  | 'em'
  | 'figcaption'
  | 'figure'
  | 'h3'
  | 'h4'
  | 'hr'
  | 'i'
  | 'iframe'
  | 'img'
  | 'li'
  | 'ol'
  | 'p'
  | 'pre'
  | 's'
  | 'strong'
  | 'u'
  | 'ul'
  | 'video';

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

export const TELEGRAPH_TAGS: readonly TelegraphTag[] = [
  'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure', 'h3', 'h4', 'hr', 'i',
  'iframe', 'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'u', 'ul', 'video',
];

/** Links Telegraph will keep: absolute web, mail and Telegram links only. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tg:\/\/)/i;

/** What one `Start` event pushed, so its `End` undoes exactly that. */
type Frame =
  | { kind: 'element'; el: TelegraphElement }
  | { kind: 'none' };

interface ListLevel {
  ordered: boolean;
  next: number;
}

interface TableState {
  rows: string[][];
  headerRows: number;
  row: string[] | null;
  cell: string[] | null;
}

function textOf(node: TelegraphNode): string {
  if (typeof node === 'string') return node;
  if (node.tag === 'br') return '\n';
  return (node.children ?? []).map(textOf).join('');
}

function displayWidth(value: string): number {
  return Array.from(value).length;
}

class TelegraphWalker {
  private readonly _root: TelegraphElement = { tag: 'p', children: [] };
  private readonly _open: TelegraphElement[] = [this._root];
  private readonly _frames: Frame[] = [];

  /** Depth of lists entered; level 0 is the one rendered as ul/ol, deeper ones are flattened. */
  private readonly _lists: ListLevel[] = [];
  private _code: string[] | null = null;
  private _image: { url: string; parts: string[] } | null = null;
  private _table: TableState | null = null;
  /** A root-level `p` made to hold stray inline content; reused until a block follows it. */
  private _implicitP: TelegraphElement | null = null;

  walk(events: [Event, Range][]): TelegraphNode[] {
    for (const [event] of events) this.handle(event);
    return normalizeChildren(this._root.children ?? []);
  }

  private get top(): TelegraphElement {
    return this._open[this._open.length - 1] ?? this._root;
  }

  private get atRoot(): boolean {
    return this.top === this._root;
  }

  /** Inside an `li` or `blockquote`, paragraphs become lines instead of nested `p`s. */
  private get inFlatContainer(): boolean {
    for (let i = this._open.length - 1; i > 0; i--) {
      const tag = this._open[i]?.tag;
      if (tag === 'li' || tag === 'blockquote' || tag === 'aside') return true;
    }
    return false;
  }

  private appendTo(parent: TelegraphElement, node: TelegraphNode) {
    if (parent.children === undefined) parent.children = [];
    parent.children.push(node);
  }

  private appendBlock(node: TelegraphElement) {
    if (this.atRoot) this._implicitP = null;
    this.appendTo(this.top, node);
  }

  private appendInline(node: TelegraphNode) {
    if (typeof node === 'string' && node === '') return;
    if (this._table !== null) {
      this._table.cell?.push(textOf(node));
      return;
    }
    if (this._image !== null) {
      this._image.parts.push(textOf(node));
      return;
    }
    if (this.atRoot) {
      if (this._implicitP === null) {
        this._implicitP = { tag: 'p', children: [] };
        this.appendTo(this._root, this._implicitP);
      }
      this.appendTo(this._implicitP, node);
      return;
    }
    this.appendTo(this.top, node);
  }

  private openElement(tag: TelegraphTag, attrs?: TelegraphAttrs, block = false) {
    const el: TelegraphElement = attrs === undefined ? { tag, children: [] } : { tag, attrs, children: [] };
    if (block) this.appendBlock(el);
    else this.appendInline(el);
    this._open.push(el);
    this._frames.push({ kind: 'element', el });
  }

  private pushNone() {
    this._frames.push({ kind: 'none' });
  }

  private closeFrame() {
    const frame = this._frames.pop();
    if (frame?.kind === 'element') {
      const index = this._open.lastIndexOf(frame.el);
      if (index > 0) this._open.splice(index, 1);
    }
  }

  /** Separates a new line of content inside a flattened container from what precedes it. */
  private lineBreakIfNotEmpty() {
    const children = this.top.children ?? [];
    if (children.length > 0) this.appendTo(this.top, { tag: 'br' });
  }

  private handle(event: Event) {
    if (typeof event === 'string') {
      if (event === 'SoftBreak') this.onText(this._code !== null ? '\n' : ' ');
      else if (event === 'HardBreak') {
        if (this._code !== null) this._code.push('\n');
        else this.appendInline({ tag: 'br' });
      } else if (event === 'Rule') this.appendBlock({ tag: 'hr' });
      return;
    }
    if ('Start' in event) this.onStart(event.Start);
    else if ('End' in event) this.onEnd(event.End);
    else if ('Text' in event) this.onText(event.Text);
    else if ('Code' in event) this.onInlineCode(event.Code);
    else if ('InlineMath' in event) this.onInlineCode(event.InlineMath);
    else if ('DisplayMath' in event) this.appendBlock({ tag: 'pre', children: [event.DisplayMath] });
    else if ('InlineHtml' in event) this.onInlineHtml(event.InlineHtml);
    else if ('Html' in event) this.onText(event.Html);
    else if ('TaskListMarker' in event) this.onText(event.TaskListMarker ? '✅ ' : '☐ ');
    else if ('FootnoteReference' in event) this.onText(`[${String(event.FootnoteReference)}]`);
  }

  private onText(text: string) {
    if (this._code !== null) {
      this._code.push(text);
      return;
    }
    this.appendInline(text);
  }

  private onInlineCode(code: string) {
    if (this._table !== null || this._image !== null) {
      this.appendInline(code);
      return;
    }
    this.appendInline({ tag: 'code', children: [code] });
  }

  private onInlineHtml(value: string) {
    const tag = value.trim().toLowerCase();
    // Spoiler markers come from preprocessSpoilers; Telegraph has no spoiler, so the text stays plain.
    if (tag === '<tg-spoiler>' || tag === '</tg-spoiler>') return;
    this.onText(value);
  }

  private inlineOrNone(tag: TelegraphTag) {
    if (this._table !== null || this._image !== null) this.pushNone();
    else this.openElement(tag);
  }

  private onStart(tag: Tag) {
    if (tag === 'Strong') this.inlineOrNone('b');
    else if (tag === 'Emphasis') this.inlineOrNone('i');
    else if (tag === 'Strikethrough') this.inlineOrNone('s');
    else if (tag === 'Paragraph' || tag === 'HtmlBlock') this.onStartParagraph();
    else if (tag === 'Item') this.onStartItem();
    else if (tag === 'TableHead' || tag === 'TableRow') {
      if (this._table !== null) this._table.row = [];
      this.pushNone();
    } else if (tag === 'TableCell') {
      if (this._table !== null) this._table.cell = [];
      this.pushNone();
    } else if (tag === 'BlockQuote') this.onStartBlockQuote();
    else if (tag === 'FootnoteDefinition') this.onStartFootnote('');
    else if ('Heading' in tag) {
      const level = String(tag.Heading.level).replace(/^H/i, '');
      this.openElement(level === '1' || level === '2' ? 'h3' : 'h4', undefined, true);
    } else if ('CodeBlock' in tag) {
      this._code = [];
      this.pushNone();
    } else if ('BlockQuote' in tag) this.onStartBlockQuote();
    else if ('List' in tag) this.onStartList(tag.List);
    else if ('Link' in tag) this.onStartLink(tag.Link.dest_url);
    else if ('Image' in tag) {
      this._image = { url: tag.Image.dest_url, parts: [] };
      this.pushNone();
    } else if ('Table' in tag) {
      this._table = { rows: [], headerRows: 0, row: null, cell: null };
      this.pushNone();
    } else if ('FootnoteDefinition' in tag) {
      this.onStartFootnote(String((tag as { FootnoteDefinition: unknown }).FootnoteDefinition));
    } else this.pushNone();
  }

  private onStartParagraph() {
    if (this.inFlatContainer) {
      this.lineBreakIfNotEmpty();
      this.pushNone();
    } else this.openElement('p', undefined, true);
  }

  private onStartBlockQuote() {
    if (this.inFlatContainer) {
      this.lineBreakIfNotEmpty();
      this.pushNone();
    } else this.openElement('blockquote', undefined, true);
  }

  private onStartFootnote(label: string) {
    this.openElement('p', undefined, true);
    if (label !== '') this.appendInline(`[${label}] `);
  }

  private onStartList(start: number | null) {
    const ordered = start !== null;
    this._lists.push({ ordered, next: start ?? 1 });
    if (this._lists.length === 1) this.openElement(ordered ? 'ol' : 'ul', undefined, true);
    // A nested list has no element of its own: its items become lines of the enclosing `li`.
    else this.pushNone();
  }

  private onStartItem() {
    const depth = this._lists.length;
    const level = this._lists[depth - 1];
    if (depth <= 1) {
      this.openElement('li', undefined, true);
      return;
    }
    this.lineBreakIfNotEmpty();
    let marker = '◦ ';
    if (level !== undefined && level.ordered) {
      marker = `${level.next}. `;
      level.next += 1;
    }
    this.appendInline(`${'   '.repeat(depth - 1)}${marker}`);
    this.pushNone();
  }

  private onStartLink(destUrl: string) {
    if (this._table !== null || this._image !== null || !SAFE_HREF.test(destUrl)) this.pushNone();
    else this.openElement('a', { href: destUrl });
  }

  private onEnd(tag: TagEnd) {
    if (tag === 'CodeBlock') {
      let code = (this._code ?? []).join('');
      if (code.endsWith('\n')) code = code.slice(0, -1);
      this._code = null;
      this.closeFrame();
      if (this._table === null) this.appendCodeBlock(code);
      return;
    }
    if (tag === 'Image') {
      const image = this._image;
      this._image = null;
      this.closeFrame();
      if (image !== null) this.appendImage(image.url, image.parts.join(''));
      return;
    }
    if (tag === 'TableCell') {
      const table = this._table;
      if (table !== null && table.row !== null) table.row.push((table.cell ?? []).join('').trim());
      if (table !== null) table.cell = null;
      this.closeFrame();
      return;
    }
    if (tag === 'TableHead' || tag === 'TableRow') {
      const table = this._table;
      if (table !== null && table.row !== null) {
        table.rows.push(table.row);
        if (tag === 'TableHead') table.headerRows = table.rows.length;
      }
      if (table !== null) table.row = null;
      this.closeFrame();
      return;
    }
    if (tag === 'Table') {
      const table = this._table;
      this._table = null;
      this.closeFrame();
      if (table !== null) this.appendBlock({ tag: 'pre', children: [renderTable(table.rows, table.headerRows)] });
      return;
    }
    if (typeof tag === 'object' && 'List' in tag) this._lists.pop();
    this.closeFrame();
  }

  private appendCodeBlock(code: string) {
    if (this.inFlatContainer) {
      this.lineBreakIfNotEmpty();
      this.appendInline({ tag: 'code', children: [code] });
    } else this.appendBlock({ tag: 'pre', children: [code] });
  }

  /** v1 has no image hosting, so a picture is a link to where it already lives. */
  private appendImage(url: string, alt: string) {
    const label = alt.trim() !== '' ? alt.trim() : url;
    const insideLink = this._open.some((el) => el.tag === 'a');
    if (SAFE_HREF.test(url) && !insideLink) this.appendInline({ tag: 'a', attrs: { href: url }, children: [`🖼 ${label}`] });
    else this.appendInline(`🖼 ${label}`);
  }
}

function renderTable(rows: string[][], headerRows: number): string {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    widths.push(rows.reduce((max, row) => Math.max(max, displayWidth(row[c] ?? '')), 0));
  }
  const line = (row: string[]) =>
    widths
      .map((width, c) => {
        const cell = row[c] ?? '';
        return cell + ' '.repeat(Math.max(0, width - displayWidth(cell)));
      })
      .join(' │ ')
      .trimEnd();
  const out: string[] = [];
  rows.forEach((row, index) => {
    out.push(line(row));
    if (headerRows > 0 && index === headerRows - 1) out.push(widths.map((w) => '─'.repeat(w)).join('─┼─'));
  });
  return out.join('\n');
}

/** Merges adjacent strings, drops empty inline elements, and trims trailing breaks. */
function normalizeChildren(children: TelegraphNode[]): TelegraphNode[] {
  const out: TelegraphNode[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      if (child === '') continue;
      const last = out[out.length - 1];
      if (typeof last === 'string') out[out.length - 1] = last + child;
      else out.push(child);
      continue;
    }
    const normalized: TelegraphElement = { tag: child.tag };
    if (child.attrs !== undefined) normalized.attrs = child.attrs;
    if (child.children !== undefined) {
      const inner = normalizeChildren(child.children);
      while (inner.length > 0) {
        const last = inner[inner.length - 1];
        if (typeof last === 'object' && last.tag === 'br') inner.pop();
        else break;
      }
      if (inner.length > 0) normalized.children = inner;
    }
    const isVoid = child.tag === 'br' || child.tag === 'hr' || child.tag === 'img';
    if (!isVoid && normalized.children === undefined) continue;
    out.push(normalized);
  }
  return out;
}

/**
 * Markdown → Telegraph `Node[]`, parsed by the same pulldown-cmark pass `richify` uses, so a text reads
 * the same on the page as in the chat.
 */
export function toTelegraphNodes(markdown: string, options?: { latexEscape?: boolean }): TelegraphNode[] {
  let preprocessed = markdown;
  if (options?.latexEscape ?? false) preprocessed = escapeLatex(preprocessed);
  preprocessed = preprocessSpoilers(preprocessed);
  const rawEvents = JSON.parse(
    md.parse(preprocessed, {
      enableStrikethrough: true,
      enableTables: true,
      enableTasklists: true,
      enableMath: true,
      enableGfm: true,
      enableFootnotes: true,
    })
  ) as [Event, Range][];
  return new TelegraphWalker().walk(rawEvents);
}

const encoder = new TextEncoder();

/** The size Telegraph's content limit is measured on: UTF-8 bytes of the JSON array, unescaped. */
export function telegraphByteLength(nodes: readonly TelegraphNode[]): number {
  return encoder.encode(JSON.stringify(nodes)).length;
}

function nodeBytes(node: TelegraphNode): number {
  return encoder.encode(JSON.stringify(node)).length;
}

/** Splits one string into pieces whose JSON form each fits `budget` bytes, on whitespace where it can. */
function splitString(value: string, budget: number): string[] {
  const pieces: string[] = [];
  let rest = value;
  while (rest !== '') {
    if (nodeBytes(rest) <= budget) {
      pieces.push(rest);
      break;
    }
    const chars = Array.from(rest);
    let lo = 1;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (nodeBytes(chars.slice(0, mid).join('')) <= budget) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const head = chars.slice(0, cut).join('');
    const space = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
    if (space > head.length / 2) cut = Array.from(head.slice(0, space + 1)).length;
    pieces.push(chars.slice(0, cut).join(''));
    rest = chars.slice(cut).join('');
  }
  return pieces;
}

/** Splits a node too big for `budget` into copies of itself, each holding a share of its children. */
function splitNode(node: TelegraphNode, budget: number): TelegraphNode[] {
  if (nodeBytes(node) <= budget) return [node];
  if (typeof node === 'string') return splitString(node, budget);
  const shell: TelegraphElement = node.attrs === undefined ? { tag: node.tag } : { tag: node.tag, attrs: node.attrs };
  const overhead = nodeBytes({ ...shell, children: [] });
  const inner = budget - overhead;
  if (inner <= 16) return [node];
  const parts: TelegraphNode[][] = [];
  let current: TelegraphNode[] = [];
  let used = 0;
  for (const child of node.children ?? []) {
    for (const piece of splitNode(child, inner)) {
      const size = nodeBytes(piece) + 1;
      if (used + size > inner && current.length > 0) {
        parts.push(current);
        current = [];
        used = 0;
      }
      current.push(piece);
      used += size;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.map((children) => ({ ...shell, children }));
}

/**
 * Packs top-level nodes into pages of at most `budgetBytes` (as `telegraphByteLength` counts them),
 * splitting only a node that cannot fit a page on its own. Order is kept; no page is empty.
 */
export function splitTelegraphNodes(nodes: readonly TelegraphNode[], budgetBytes: number): TelegraphNode[][] {
  if (budgetBytes < 64) throw new Error('budgetBytes is too small for any Telegraph page');
  const pages: TelegraphNode[][] = [];
  let current: TelegraphNode[] = [];
  let used = 2;
  for (const node of nodes) {
    for (const piece of splitNode(node, budgetBytes - 2)) {
      const size = nodeBytes(piece) + (current.length > 0 ? 1 : 0);
      if (used + size > budgetBytes && current.length > 0) {
        pages.push(current);
        current = [];
        used = 2;
      }
      current.push(piece);
      used += nodeBytes(piece) + (current.length > 1 ? 1 : 0);
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

/** True when every element of `nodes` uses an allowed tag and only `href`/`src`. */
export function isTelegraphSafe(nodes: readonly TelegraphNode[]): boolean {
  return nodes.every((node) => {
    if (typeof node === 'string') return true;
    if (!TELEGRAPH_TAGS.includes(node.tag)) return false;
    const attrKeys = Object.keys(node.attrs ?? {});
    if (attrKeys.some((key) => key !== 'href' && key !== 'src')) return false;
    return isTelegraphSafe(node.children ?? []);
  });
}

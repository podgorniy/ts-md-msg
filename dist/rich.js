import { parseMarkdown, STANDARD_OPTIONS, validateTelegramEmoji } from './converter.js';
/** Parser options for the Rich HTML backend. */
export const RICH_OPTIONS = STANDARD_OPTIONS;
// Telegram Rich Message limits (Bot API 10.1+). The byte limit is applied to
// the HTML markup, an upper bound of the 32768 characters of text Telegram counts.
export const RICH_BYTE_LIMIT = 32768;
export const RICH_BLOCK_LIMIT = 500;
export const RICH_MEDIA_LIMIT = 50;
const RICH_MAX_DEPTH = 16;
function escapeHtmlText(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function escapeHtmlAttr(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
const NAMED_ENTITIES = {
    lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
    mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};
function unescapeHtml(value) {
    return value.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, (m, ref) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return code <= 0x10ffff ? String.fromCodePoint(code) : m;
        }
        return NAMED_ENTITIES[ref] ?? m;
    });
}
function utf8Len(value) {
    return Buffer.byteLength(value, 'utf8');
}
// Tags Telegram parses into a counted block: every RichBlock type, list items
// and table rows. Over-counting only makes a split happen earlier.
const COUNTED_BLOCK_RE = /<(?:p|h[1-6]|pre|footer|hr|tg-math-block|ul|ol|li|blockquote|aside|tg-collage|tg-slideshow|table|tr|details|tg-map|tg-button-row|img|video|audio|tg-document|tg-thinking)(?=[\s>/])/gi;
const MEDIA_RE = /<(?:img|video|audio|tg-document)(?=[\s>/])/gi;
function countMatches(re, value) {
    return value.match(re)?.length ?? 0;
}
function makeBlock(htmlText) {
    return {
        html: htmlText,
        byteLen: utf8Len(htmlText),
        // Bare text or inline markup at the top level still becomes a paragraph
        blockCount: Math.max(1, countMatches(COUNTED_BLOCK_RE, htmlText)),
        mediaCount: countMatches(MEDIA_RE, htmlText),
    };
}
const TG_MEDIA_LINK = {
    'tg://photo?id=': 'img',
    'tg://video?id=': 'video',
    'tg://audio?id=': 'audio',
    'tg://document?id=': 'tg-document',
};
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'gif']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav', 'flac', 'aac']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg']);
/**
 * The Rich HTML media tag for a Markdown image URL, or null when the URL cannot
 * be a media block (Telegram takes only HTTP(S) URLs and tg:// media links).
 * The type comes from the file extension; an unknown one is sent as a document,
 * no extension as a photo.
 */
function mediaTagFor(url) {
    for (const [prefix, tag] of Object.entries(TG_MEDIA_LINK)) {
        if (url.startsWith(prefix))
            return tag;
    }
    if (!/^https?:\/\//i.test(url))
        return null;
    const path = url.replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]*/i, '');
    const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
    if (!ext || IMAGE_EXT.has(ext))
        return 'img';
    if (VIDEO_EXT.has(ext))
        return 'video';
    if (AUDIO_EXT.has(ext))
        return 'audio';
    return 'tg-document';
}
// Inline HTML the Markdown source may use for formatting Markdown has no syntax
// for. Only bare tags pass through; anything else is shown as text.
const PASSTHROUGH_INLINE_TAGS = new Set(['u', 'ins', 'sub', 'sup', 'mark', 'b', 'strong', 'i', 'em', 's', 'del', 'strike', 'code', 'tg-spoiler']);
const BARE_TAG_RE = /^<(\/?)([a-z][a-z0-9-]*)\s*>$/;
class RichHtmlWalker {
    _parts = [];
    _inlineClosers = [];
    _listStack = [];
    _pendingParagraph = false;
    _paragraphOpen = false;
    _inParagraph = false;
    _afterMedia = false;
    _inCodeBlock = false;
    _codeBlockLang = '';
    _codeBlockParts = [];
    _inHeading = false;
    _headingLevels = [];
    _inTableHead = false;
    _inTableCell = false;
    _tableAlignments = [];
    _tableRows = [];
    _currentRow = [];
    _cellParts = [];
    _image = null;
    _pendingReference = null;
    _blockDepth = 0;
    _blocks = [];
    _blockMode = false;
    walk(events) {
        for (const [event] of events) {
            this.handleEvent(event);
        }
        this.closeParagraph();
        return this._parts.join('');
    }
    walkBlocks(events) {
        this._blockMode = true;
        for (const [event] of events) {
            this.handleEvent(event);
        }
        this.closeParagraph();
        this.flushBlock();
        return this._blocks;
    }
    handleEvent(event) {
        if (typeof event === 'string') {
            if (event === 'SoftBreak')
                this.onSoftBreak();
            else if (event === 'HardBreak')
                this.onHardBreak();
            else if (event === 'Rule') {
                this.closeParagraph();
                this.enterBlock();
                this.emit('<hr/>');
                this.leaveBlock();
            }
            return;
        }
        if ('Start' in event)
            this.onStart(event.Start);
        else if ('End' in event)
            this.onEnd(event.End);
        else if ('Text' in event)
            this.onText(event.Text);
        else if ('Code' in event)
            this.onInlineCode(event.Code);
        else if ('InlineMath' in event) {
            this.writeInline(`<tg-math>${escapeHtmlText(event.InlineMath)}</tg-math>`);
        }
        else if ('DisplayMath' in event) {
            this.closeParagraph();
            this.enterBlock();
            this.emit(`<tg-math-block>${escapeHtmlText(event.DisplayMath)}</tg-math-block>`);
            this.leaveBlock();
        }
        else if ('InlineHtml' in event)
            this.onInlineHtml(event.InlineHtml);
        else if ('Html' in event)
            this.writeInline(escapeHtmlText(event.Html));
        else if ('TaskListMarker' in event) {
            // Native checkbox; emit (not writeInline) keeps it a direct child of <li>
            // even when a loose item opens a <p>
            this.emit(event.TaskListMarker ? '<input type="checkbox" checked/>' : '<input type="checkbox"/>');
        }
        else if ('FootnoteReference' in event) {
            const ref = String(event.FootnoteReference);
            this.writeInline(`<a href="${escapeHtmlAttr(`#${ref}`)}">${escapeHtmlText(`[${ref}]`)}</a>`);
        }
    }
    onInlineHtml(value) {
        const match = BARE_TAG_RE.exec(value.trim().toLowerCase());
        if (match && PASSTHROUGH_INLINE_TAGS.has(match[2])) {
            const [, slash, name] = match;
            if (!slash) {
                this.openInline(`<${name}>`, `</${name}>`);
                return;
            }
            if (this._inlineClosers[this._inlineClosers.length - 1] === `</${name}>`) {
                this.closeInline();
                return;
            }
        }
        if (match && match[2] === 'br') {
            this.writeInline('<br/>');
            return;
        }
        this.writeInline(escapeHtmlText(value));
    }
    onStart(tag) {
        if (tag === 'Strong')
            this.openInline('<b>', '</b>');
        else if (tag === 'Emphasis')
            this.openInline('<i>', '</i>');
        else if (tag === 'Strikethrough')
            this.openInline('<s>', '</s>');
        else if (tag === 'Paragraph') {
            this.enterBlock();
            this._pendingParagraph = true;
            this._inParagraph = true;
        }
        else if (tag === 'Item') {
            this.closeParagraph();
            this.emit('<li>');
        }
        else if (tag === 'TableHead') {
            this._currentRow = [];
            this._inTableHead = true;
        }
        else if (tag === 'TableRow') {
            this._currentRow = [];
        }
        else if (tag === 'TableCell') {
            this._cellParts = [];
            this._inTableCell = true;
        }
        else if (tag === 'HtmlBlock') {
            this.enterBlock();
            this._pendingParagraph = true;
            this._inParagraph = true;
        }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag) {
                this.enterBlock();
                this.onStartHeading(tag.Heading);
            }
            else if ('CodeBlock' in tag) {
                this.enterBlock();
                this.onStartCodeBlock(tag.CodeBlock);
            }
            else if ('BlockQuote' in tag) {
                this.enterBlock();
                this.closeParagraph();
                this.emit('<blockquote>');
            }
            else if ('Link' in tag)
                this.onStartLink(tag.Link);
            else if ('Image' in tag)
                this.onStartImage(tag.Image);
            else if ('List' in tag) {
                this.enterBlock();
                this.onStartList(tag.List);
            }
            else if ('Table' in tag) {
                this.enterBlock();
                this.onStartTable(tag.Table);
            }
            else if ('FootnoteDefinition' in tag) {
                this.enterBlock();
                this.closeParagraph();
                // RichTextReference is inline: the first paragraph of the definition
                // carries <tg-reference>, see openParagraphIfPending
                this._pendingReference = String(tag.FootnoteDefinition);
            }
        }
    }
    onEnd(tag) {
        if (tag === 'Strong')
            this.closeInline();
        else if (tag === 'Emphasis')
            this.closeInline();
        else if (tag === 'Strikethrough')
            this.closeInline();
        else if (tag === 'Paragraph' || tag === 'HtmlBlock') {
            // HtmlBlock must pair with its enterBlock too, or walkBlocks merges
            // everything after it into one block
            this.closeParagraph();
            this._inParagraph = false;
            this.leaveBlock();
        }
        else if (tag === 'Item') {
            this.closeParagraph();
            this.emit('</li>');
        }
        else if (tag === 'CodeBlock') {
            this.onEndCodeBlock();
            this.leaveBlock();
        }
        else if (tag === 'Table') {
            this.onEndTable();
            this.leaveBlock();
        }
        else if (tag === 'TableCell')
            this.onEndTableCell();
        else if (tag === 'TableRow')
            this.onEndTableRow();
        else if (tag === 'TableHead') {
            this.onEndTableRow();
            this._inTableHead = false;
        }
        else if (tag === 'Link')
            this.closeInline();
        else if (tag === 'Image')
            this.onEndImage();
        else if (tag === 'FootnoteDefinition') {
            this.closeParagraph();
            this._pendingReference = null;
            this.leaveBlock();
        }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag) {
                const level = this._headingLevels.pop() || 1;
                this.emit(`</h${level}>`);
                this._inHeading = false;
                this.leaveBlock();
            }
            else if ('BlockQuote' in tag) {
                this.closeParagraph();
                this.emit('</blockquote>');
                this.leaveBlock();
            }
            else if ('List' in tag) {
                this.onEndList();
                this.leaveBlock();
            }
        }
    }
    onText(text) {
        if (this._inCodeBlock) {
            this._codeBlockParts.push(text);
            return;
        }
        if (this._image !== null) {
            this._image.parts.push(text);
            return;
        }
        // Whitespace between a media block and the next inline content
        if (this._afterMedia)
            text = text.replace(/^\s+/, '');
        if (!text)
            return;
        this.writeInline(escapeHtmlText(text));
    }
    onSoftBreak() {
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
    onHardBreak() {
        if (this._inCodeBlock) {
            this._codeBlockParts.push('\n');
            return;
        }
        this.writeInline('<br/>');
    }
    onInlineCode(code) {
        if (this._image !== null) {
            this._image.parts.push(code);
            return;
        }
        this.writeInline(`<code>${escapeHtmlText(code)}</code>`);
    }
    onStartHeading(headingData) {
        this.closeParagraph();
        const level = this.headingLevel(headingData);
        this._headingLevels.push(level);
        this._inHeading = true;
        this.emit(`<h${level}>`);
    }
    onStartCodeBlock(kind) {
        this.closeParagraph();
        this._inCodeBlock = true;
        this._codeBlockParts = [];
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
        if (rawCode.endsWith('\n'))
            rawCode = rawCode.substring(0, rawCode.length - 1);
        const lang = this._codeBlockLang ? this._codeBlockLang.split(',')[0].trim() : '';
        const escapedCode = escapeHtmlText(rawCode);
        if (lang.toLowerCase() === 'math') {
            this.emit(`<tg-math-block>${escapedCode}</tg-math-block>`);
        }
        else if (lang) {
            const escapedLang = escapeHtmlAttr(`language-${lang}`);
            this.emit(`<pre><code class="${escapedLang}">${escapedCode}</code></pre>`);
        }
        else {
            this.emit(`<pre>${escapedCode}</pre>`);
        }
        this._codeBlockLang = '';
        this._codeBlockParts = [];
    }
    onStartLink(linkData) {
        const destUrl = linkData.dest_url || '';
        const emojiId = validateTelegramEmoji(destUrl);
        if (emojiId) {
            this.openInline(`<tg-emoji emoji-id="${escapeHtmlAttr(emojiId)}">`, '</tg-emoji>');
        }
        else if (destUrl) {
            this.openInline(`<a href="${escapeHtmlAttr(destUrl)}">`, '</a>');
        }
        else {
            this._inlineClosers.push('');
        }
    }
    onStartImage(imageData) {
        this._image = {
            url: imageData.dest_url || '',
            title: imageData.title || '',
            parts: [],
        };
    }
    onEndImage() {
        if (this._image === null)
            return;
        const image = this._image;
        this._image = null;
        const alt = image.parts.join('');
        const emojiId = validateTelegramEmoji(image.url);
        if (emojiId) {
            this.writeInline(`<tg-emoji emoji-id="${escapeHtmlAttr(emojiId)}">${escapeHtmlText(alt)}</tg-emoji>`);
            return;
        }
        // Media is a block of its own: it cannot sit inside a heading, a table cell
        // or an open inline tag, so there it degrades to a link
        const mediaTag = mediaTagFor(image.url);
        const canBeBlock = !this._inHeading && !this._inTableCell && this._inlineClosers.length === 0;
        if (mediaTag && canBeBlock) {
            this.emitMedia(mediaTag, image.url, image.title);
            return;
        }
        if (image.url) {
            const href = escapeHtmlAttr(image.url);
            const text = escapeHtmlText(alt || image.title || image.url);
            this.writeInline(`<a href="${href}">${text}</a>`);
        }
        else {
            this.writeInline(escapeHtmlText(alt));
        }
    }
    emitMedia(tag, url, caption) {
        const src = `src="${escapeHtmlAttr(url)}"`;
        const element = tag === 'img' ? `<img ${src}/>` : `<${tag} ${src}></${tag}>`;
        // Close the paragraph around the media; inline content after it reopens one
        const inParagraph = this._inParagraph && (this._paragraphOpen || this._pendingParagraph);
        this.closeParagraph();
        this.emit(caption ? `<figure>${element}<figcaption>${escapeHtmlText(caption)}</figcaption></figure>` : element);
        if (inParagraph) {
            this._pendingParagraph = true;
            this._afterMedia = true;
        }
    }
    onStartList(startNumber) {
        this.closeParagraph();
        if (startNumber === null || startNumber === undefined) {
            this.emit('<ul>');
            this._listStack.push({ tag: 'ul' });
        }
        else {
            this.emit(`<ol start="${Math.floor(startNumber)}">`);
            this._listStack.push({ tag: 'ol' });
        }
    }
    onEndList() {
        this.closeParagraph();
        if (this._listStack.length > 0) {
            const scope = this._listStack.pop();
            this.emit(`</${scope.tag}>`);
        }
    }
    onStartTable(alignments) {
        this.closeParagraph();
        this._tableAlignments = Array.isArray(alignments) ? alignments : [];
        this._tableRows = [];
    }
    onEndTableCell() {
        const content = this._cellParts.join('');
        this._currentRow.push([content, this._inTableHead]);
        this._cellParts = [];
        this._inTableCell = false;
    }
    onEndTableRow() {
        if (this._currentRow.length > 0) {
            this._tableRows.push(this._currentRow);
        }
        this._currentRow = [];
    }
    onEndTable() {
        const rowsHtml = [];
        for (const row of this._tableRows) {
            const cellsHtml = [];
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
    enterBlock() {
        this._blockDepth++;
    }
    leaveBlock() {
        this._blockDepth--;
        if (this._blockMode && this._blockDepth === 0) {
            this.flushBlock();
        }
    }
    flushBlock() {
        if (this._parts.length === 0)
            return;
        const blockHtml = this._parts.join('');
        this._parts = [];
        this._blocks.push(makeBlock(blockHtml));
    }
    openInline(openTag, closeTag) {
        this.writeInline(openTag);
        this._inlineClosers.push(closeTag);
    }
    closeInline() {
        if (this._inlineClosers.length > 0) {
            const closer = this._inlineClosers.pop();
            if (closer)
                this.writeInline(closer);
        }
    }
    writeInline(value) {
        // A paragraph reopened after a media block never starts with a line break
        if (this._afterMedia && value === '<br/>')
            return;
        this.openParagraphIfPending();
        this.emit(value);
    }
    emit(value) {
        if (this._inTableCell)
            this._cellParts.push(value);
        else
            this._parts.push(value);
    }
    openParagraphIfPending() {
        this._afterMedia = false;
        if (this._pendingParagraph && !this._paragraphOpen && !this._inTableCell) {
            this._parts.push('<p>');
            this._paragraphOpen = true;
            if (this._pendingReference !== null) {
                const name = this._pendingReference;
                this._pendingReference = null;
                this._parts.push(`${escapeHtmlText(`[${name}]`)} <tg-reference name="${escapeHtmlAttr(name)}">`);
                this._inlineClosers.push('</tg-reference>');
                this._referenceDepth = this._inlineClosers.length;
            }
        }
        this._pendingParagraph = false;
    }
    _referenceDepth = 0;
    closeParagraph() {
        this._pendingParagraph = false;
        this._afterMedia = false;
        if (this._paragraphOpen) {
            if (this._referenceDepth > 0) {
                // Close the reference opened with this paragraph
                while (this._inlineClosers.length >= this._referenceDepth) {
                    this._parts.push(this._inlineClosers.pop());
                }
                this._referenceDepth = 0;
            }
            this._parts.push('</p>');
            this._paragraphOpen = false;
        }
    }
    tableAlignment(index) {
        if (index >= this._tableAlignments.length)
            return '';
        const value = String(this._tableAlignments[index]).toLowerCase();
        if (value === 'left' || value === 'center' || value === 'right')
            return value;
        return '';
    }
    headingLevel(headingData) {
        let level = 'H1';
        if (typeof headingData === 'object' && headingData !== null && headingData.level)
            level = String(headingData.level);
        else if (typeof headingData === 'string' || typeof headingData === 'number')
            level = String(headingData);
        if (level.startsWith('H')) {
            const num = parseInt(level.substring(1), 10);
            if (!isNaN(num))
                return Math.max(1, Math.min(6, num));
        }
        return 1;
    }
}
function buildMessage(content, options) {
    const message = { ...content };
    if (options?.media !== undefined)
        message.media = options.media;
    if (options?.isRtl !== undefined)
        message.is_rtl = options.isRtl;
    if (options?.skipEntityDetection !== undefined)
        message.skip_entity_detection = options.skipEntityDetection;
    return message;
}
function walkRichEvents(markdown, latexEscape) {
    return parseMarkdown(markdown, RICH_OPTIONS, latexEscape).events;
}
/**
 * Convert Markdown to a Telegram InputRichMessage for sendRichMessage.
 *
 * `mode: 'html'` renders Telegram Rich HTML; `mode: 'markdown'` passes the input
 * through for Telegram to render as Rich Markdown.
 */
export function richify(markdown, options) {
    const mode = options?.mode ?? 'html';
    if (mode === 'markdown')
        return buildMessage({ markdown }, options);
    if (mode !== 'html') {
        throw new Error("mode must be 'html' or 'markdown'");
    }
    const events = walkRichEvents(markdown, options?.latexEscape ?? false);
    return buildMessage({ html: new RichHtmlWalker().walk(events) }, options);
}
function splitTextByUtf8Bytes(text, byteLimit) {
    if (byteLimit <= 0)
        throw new Error('byteLimit must leave room for wrapper tags');
    const chunks = [];
    let current = '';
    let currentBytes = 0;
    for (const ch of text) {
        const chBytes = utf8Len(ch);
        if (current.length > 0 && currentBytes + chBytes > byteLimit) {
            chunks.push(current);
            current = '';
            currentBytes = 0;
        }
        current += ch;
        currentBytes += chBytes;
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
/** Split raw text by the byte length it will have after HTML escaping. */
function splitTextByEscapedUtf8Bytes(text, byteLimit) {
    if (byteLimit <= 0)
        throw new Error('byteLimit must leave room for wrapper tags');
    const chunks = [];
    let current = '';
    let currentBytes = 0;
    for (const ch of text) {
        const escapedBytes = utf8Len(escapeHtmlText(ch));
        if (current.length > 0 && currentBytes + escapedBytes > byteLimit) {
            chunks.push(current);
            current = '';
            currentBytes = 0;
        }
        current += ch;
        currentBytes += escapedBytes;
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
function htmlFragmentToText(fragment) {
    return unescapeHtml(fragment.replace(/<[^>]*>/g, ''));
}
// One token of inline Rich HTML: a tag (a quoted attribute value may hold '>'),
// a character reference, a whitespace run, or a run of other text. Runs stay
// short so that a part can end close to its byte budget.
const INLINE_TOKEN_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?\/?>|&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);|\s{1,64}|[^<&\s]{1,64}|[<&]/gu;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr', 'input']);
function inlineTokens(fragment) {
    const tokens = [];
    for (const match of fragment.matchAll(INLINE_TOKEN_RE)) {
        const token = match[0];
        const name = (match[1] || '').toLowerCase();
        let kind;
        if (!name)
            kind = /^\s+$/.test(token) ? 'space' : 'text';
        else if (token.startsWith('</'))
            kind = 'close';
        else if (name === 'br')
            kind = 'br';
        else if (token.endsWith('/>') || VOID_TAGS.has(name))
            kind = 'void';
        else
            kind = 'open';
        tokens.push([token, kind, name]);
    }
    return tokens;
}
/** Split text at the last code point boundary within `budget` UTF-8 bytes. */
function splitByUtf8Budget(text, budget) {
    let bytes = 0;
    let index = 0;
    for (const ch of text) {
        const chBytes = utf8Len(ch);
        if (bytes + chBytes > budget)
            break;
        bytes += chBytes;
        index += ch.length;
    }
    return [text.substring(0, index), text.substring(index)];
}
/**
 * Split inline Rich HTML into parts of at most `budget` UTF-8 bytes each. A cut
 * closes the tags open at that point and reopens them at the start of the next
 * part, so every part keeps its formatting. Cuts prefer the point after a
 * `<br/>`, then after whitespace. Returns null when the fragment is not
 * well-formed, or a part cannot hold one token besides the tags it reopens.
 */
function splitInlineHtml(fragment, budget) {
    const tokens = inlineTokens(fragment);
    const parts = [];
    let carried = [];
    let start = 0;
    while (start < tokens.length) {
        let stack = carried;
        let size = stack.reduce((acc, [openTag]) => acc + utf8Len(openTag), 0);
        let reserve = stack.reduce((acc, [, closer]) => acc + closer.length, 0);
        let lineCut = null;
        let spaceCut = null;
        let end = start;
        while (end < tokens.length) {
            const [token, kind, name] = tokens[end];
            const tokenSize = utf8Len(token);
            let nextStack = stack;
            let nextReserve = reserve;
            if (kind === 'close') {
                if (stack.length === 0 || stack[stack.length - 1][1] !== `</${name}>`)
                    return null;
                nextStack = stack.slice(0, -1);
                nextReserve = reserve - stack[stack.length - 1][1].length;
            }
            else if (kind === 'open') {
                const closer = `</${name}>`;
                nextStack = [...stack, [token, closer]];
                nextReserve = reserve + closer.length;
            }
            if (size + tokenSize + nextReserve > budget) {
                // No break point yet: cut the text run itself rather than waste the part
                if (kind === 'text' && lineCut === null && spaceCut === null) {
                    const [head, tail] = splitByUtf8Budget(token, budget - size - reserve);
                    if (head)
                        tokens.splice(end, 1, [head, 'text', ''], [tail, 'text', '']);
                }
                if (tokens[end][0] === token)
                    break;
                continue;
            }
            size += tokenSize;
            stack = nextStack;
            reserve = nextReserve;
            end++;
            if (kind === 'br')
                lineCut = [end, stack];
            else if (kind === 'space')
                spaceCut = [end, stack];
        }
        let cut;
        let cutStack;
        if (end === tokens.length) {
            if (stack.length > 0)
                return null;
            [cut, cutStack] = [end, stack];
        }
        else if (end === start) {
            return null;
        }
        else {
            [cut, cutStack] = lineCut ?? spaceCut ?? [end, stack];
        }
        parts.push(carried.map(([openTag]) => openTag).join('')
            + tokens.slice(start, cut).map(([token]) => token).join('')
            + [...cutStack].reverse().map(([, closer]) => closer).join(''));
        start = cut;
        carried = cutStack;
    }
    return parts;
}
function extractWrappedText(htmlText, tag) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    if (htmlText.startsWith(openTag) && htmlText.endsWith(closeTag)) {
        return htmlText.substring(openTag.length, htmlText.length - closeTag.length);
    }
    return null;
}
function extractPreText(htmlText) {
    // The closer must match the opener: a greedy body would swallow </code>
    const match = htmlText.match(/^(<pre><code class="[^"]+">)(.*)(<\/code><\/pre>)$/s)
        ?? htmlText.match(/^(<pre>)(?!<code)(.*)(<\/pre>)$/s);
    if (!match)
        return null;
    return [match[1], match[2], match[3]];
}
// The attribute part tolerates a quoted value containing '>': splitRich() is
// public and may be handed HTML the caller wrote.
const CONTAINER_OPEN_RE = /^<(blockquote|ul|ol|table)(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>/;
const OL_START_RE = /(?<![-\w])start\s*=\s*(?:"(\d+)"|'(\d+)')/;
const OL_ANY_START_RE = /(?<![-\w])start\s*=/;
/** If the fragment is exactly one splittable container: [open tag, inner HTML, close tag, tag name]. */
function extractContainer(htmlText) {
    const match = CONTAINER_OPEN_RE.exec(htmlText);
    if (!match)
        return null;
    const tag = match[1];
    const closeTag = `</${tag}>`;
    if (!htmlText.endsWith(closeTag))
        return null;
    // The close tag must pair with this open tag, not a nested one of the same name
    if (findTagEnd(htmlText, 0, tag) !== htmlText.length)
        return null;
    return [match[0], htmlText.substring(match[0].length, htmlText.length - closeTag.length), closeTag, tag];
}
/**
 * Continue an ordered list from the previous part's numbering. The start value
 * is rewritten in place; a `start` this cannot parse is left alone, since a
 * second `start` attribute would be invalid HTML.
 */
function reopenTag(openTag, tag, itemsBefore) {
    if (tag !== 'ol' || itemsBefore === 0)
        return openTag;
    const match = OL_START_RE.exec(openTag);
    if (match) {
        const value = match[1] ?? match[2];
        const valueStart = match.index + match[0].lastIndexOf(value);
        return openTag.substring(0, valueStart) + String(parseInt(value, 10) + itemsBefore) + openTag.substring(valueStart + value.length);
    }
    if (OL_ANY_START_RE.test(openTag))
        return openTag;
    return `<ol start="${1 + itemsBefore}"` + openTag.substring('<ol'.length);
}
function fits(block, budget) {
    return block.byteLen <= budget.bytes && block.blockCount <= budget.blocks && block.mediaCount <= budget.media;
}
/** Split a container by direct child, re-wrapping each part in its tags. */
function splitContainer(openTag, inner, closeTag, tag, budget, depth) {
    const children = heuristicHtmlBlocks(inner);
    if (children.length === 0)
        return [];
    // An <ol> continuation renumbers its opening tag; budget against the widest
    const totalItems = children.filter(child => child.html.startsWith('<li')).length;
    const wrapper = makeBlock(openTag + closeTag);
    const widestOpen = Math.max(utf8Len(openTag), utf8Len(reopenTag(openTag, tag, totalItems)));
    const childBudget = {
        bytes: budget.bytes - widestOpen - utf8Len(closeTag),
        blocks: budget.blocks - wrapper.blockCount,
        media: budget.media,
    };
    if (childBudget.bytes <= 0 || childBudget.blocks <= 0)
        return [];
    // Split any single oversized child first, or binning yields one oversized bin
    const expanded = [];
    for (const child of children) {
        if (!fits(child, childBudget)) {
            const pieces = splitOversizedBlock(child, childBudget, depth + 1);
            expanded.push(...(pieces.length > 0 ? pieces : [child]));
        }
        else {
            expanded.push(child);
        }
    }
    const groups = [];
    let current = [];
    let used = { bytes: 0, blocks: 0, media: 0 };
    for (const child of expanded) {
        const over = used.bytes + child.byteLen > childBudget.bytes
            || used.blocks + child.blockCount > childBudget.blocks
            || used.media + child.mediaCount > childBudget.media;
        if (current.length > 0 && over) {
            groups.push(current);
            current = [];
            used = { bytes: 0, blocks: 0, media: 0 };
        }
        current.push(child);
        used = { bytes: used.bytes + child.byteLen, blocks: used.blocks + child.blockCount, media: used.media + child.mediaCount };
    }
    if (current.length > 0)
        groups.push(current);
    if (groups.length <= 1)
        return [];
    const blocks = [];
    let itemsBefore = 0;
    for (const group of groups) {
        blocks.push(makeBlock(reopenTag(openTag, tag, itemsBefore) + group.map(child => child.html).join('') + closeTag));
        // Direct children only: an <li> of a nested list does not consume an outer ordinal
        itemsBefore += group.filter(child => child.html.startsWith('<li')).length;
    }
    return blocks;
}
/**
 * Split a block that exceeds the budget while keeping valid Rich HTML.
 * Paragraphs and preformatted blocks split by text, containers by direct child.
 * An empty result means the block cannot be split.
 */
function splitOversizedBlock(block, budget, depth = 0) {
    const htmlText = block.html;
    const paragraph = extractWrappedText(htmlText, 'p');
    if (paragraph !== null) {
        const byteBudget = budget.bytes - utf8Len('<p></p>');
        let parts = splitInlineHtml(paragraph, byteBudget);
        if (parts === null) {
            console.warn('Paragraph cannot be split without breaking a tag; splitting its plain text instead, which drops its formatting.');
            parts = splitTextByEscapedUtf8Bytes(htmlFragmentToText(paragraph), byteBudget).map(escapeHtmlText);
        }
        return parts.filter(p => p).map(p => makeBlock(`<p>${p}</p>`));
    }
    const pre = extractPreText(htmlText);
    if (pre !== null) {
        const [openTag, content, closeTag] = pre;
        const byteBudget = budget.bytes - utf8Len(openTag + closeTag);
        const parts = splitTextByEscapedUtf8Bytes(unescapeHtml(content), byteBudget);
        return parts.filter(p => p).map(p => makeBlock(openTag + escapeHtmlText(p) + closeTag));
    }
    const container = extractContainer(htmlText);
    // Containers nested past Telegram's depth limit go out unsplit
    if (container !== null && depth < RICH_MAX_DEPTH) {
        return splitContainer(...container, budget, depth);
    }
    return [];
}
function flushChunk(chunks, blocks, template) {
    const html = blocks.map(b => b.html).join('');
    const { markdown: _markdown, html: _html, media, ...flags } = template;
    const chunk = { html, ...flags };
    // Each chunk carries only the media its own HTML references
    const usedMedia = media?.filter(m => html.includes(`?id=${m.id}"`) || html.includes(`?id=${m.id}&`));
    if (usedMedia && usedMedia.length > 0)
        chunk.media = usedMedia;
    chunks.push(chunk);
}
function binBlocks(blocks, limits, template) {
    if (blocks.length === 0)
        return [];
    const budget = { bytes: limits.byteLimit, blocks: limits.blockLimit, media: limits.mediaLimit };
    const chunks = [];
    let currentBlocks = [];
    let used = { bytes: 0, blocks: 0, media: 0 };
    const flush = () => {
        if (currentBlocks.length > 0)
            flushChunk(chunks, currentBlocks, template);
        currentBlocks = [];
        used = { bytes: 0, blocks: 0, media: 0 };
    };
    for (const block of blocks) {
        if (!fits(block, budget)) {
            flush();
            const splitBlocks = splitOversizedBlock(block, budget);
            for (const sb of splitBlocks.length > 0 ? splitBlocks : [block]) {
                // A split can still leave an atomic child over the limit
                if (!fits(sb, budget)) {
                    console.warn(`Rich block exceeds Telegram's limits (${sb.byteLen} bytes, ${sb.blockCount} blocks, ${sb.mediaCount} media) `
                        + 'and cannot be split further; sending it alone. Telegram may reject it.');
                }
                flushChunk(chunks, [sb], template);
            }
            continue;
        }
        if (used.bytes + block.byteLen > budget.bytes
            || used.blocks + block.blockCount > budget.blocks
            || used.media + block.mediaCount > budget.media) {
            flush();
        }
        currentBlocks.push(block);
        used = { bytes: used.bytes + block.byteLen, blocks: used.blocks + block.blockCount, media: used.media + block.mediaCount };
    }
    flush();
    return chunks;
}
const BLOCK_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'footer', 'blockquote', 'aside',
    'ul', 'ol', 'li', 'table', 'tr', 'hr', 'tg-math-block', 'img', 'video', 'audio', 'tg-document',
    'figure', 'tg-map', 'tg-collage', 'tg-slideshow', 'tg-reference', 'details', 'tg-button-row',
]);
const SELF_CLOSING_BLOCK_TAGS = new Set(['hr', 'img', 'tg-map']);
function findTagEnd(htmlContent, start, tagName) {
    let depth = 0;
    const length = htmlContent.length;
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    const regex = new RegExp(`<(\\/?)(${escaped})(?:\\s[^>]*?)?(\\/?)>`, 'gi');
    regex.lastIndex = start;
    let match;
    while ((match = regex.exec(htmlContent)) !== null) {
        if (match[1] === '/') {
            depth--;
            if (depth === 0)
                return match.index + match[0].length;
        }
        else if (match[3] === '/') {
            // A self-closed tag at the outer level is the whole element
            if (depth === 0)
                return match.index + match[0].length;
        }
        else {
            depth++;
        }
    }
    return length;
}
/**
 * Recover top-level blocks from rendered Rich HTML. Bare text between blocks,
 * as in caller-written HTML, is a block of its own.
 */
function heuristicHtmlBlocks(htmlContent) {
    const blocks = [];
    let pos = 0;
    const length = htmlContent.length;
    while (pos < length) {
        if (htmlContent[pos] !== '<') {
            let nextTag = htmlContent.indexOf('<', pos);
            if (nextTag === -1)
                nextTag = length;
            const fragment = htmlContent.substring(pos, nextTag);
            if (fragment.trim())
                blocks.push(makeBlock(fragment));
            pos = nextTag;
            continue;
        }
        const match = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(htmlContent.substring(pos, pos + 64));
        if (!match) {
            let nextTag = htmlContent.indexOf('<', pos + 1);
            if (nextTag === -1)
                nextTag = length;
            blocks.push(makeBlock(htmlContent.substring(pos, nextTag)));
            pos = nextTag;
            continue;
        }
        const tagName = match[1].toLowerCase();
        let end;
        if (BLOCK_TAGS.has(tagName) && SELF_CLOSING_BLOCK_TAGS.has(tagName)) {
            const close = htmlContent.indexOf('>', pos);
            end = close === -1 ? length : close + 1;
        }
        else {
            end = findTagEnd(htmlContent, pos, tagName);
        }
        blocks.push(makeBlock(htmlContent.substring(pos, end)));
        pos = end;
    }
    return blocks;
}
function resolveLimits(options) {
    return {
        byteLimit: options?.byteLimit ?? RICH_BYTE_LIMIT,
        blockLimit: options?.blockLimit ?? RICH_BLOCK_LIMIT,
        mediaLimit: options?.mediaLimit ?? RICH_MEDIA_LIMIT,
    };
}
function splitMarkdown(richMessage, byteLimit) {
    const mdContent = richMessage.markdown;
    if (!mdContent.trim())
        return [];
    if (utf8Len(mdContent) <= byteLimit)
        return [richMessage];
    const { markdown: _markdown, html: _html, ...rest } = richMessage;
    const chunk = (markdown) => ({ markdown, ...rest });
    const paragraphs = mdContent.split('\n\n');
    const chunks = [];
    let currentParts = [];
    let currentBytes = 0;
    for (const para of paragraphs) {
        const paraBytes = utf8Len(para);
        const sepBytes = currentParts.length > 0 ? 2 : 0;
        if (paraBytes > byteLimit) {
            if (currentParts.length > 0) {
                chunks.push(chunk(currentParts.join('\n\n')));
                currentParts = [];
                currentBytes = 0;
            }
            for (const part of splitTextByUtf8Bytes(para, byteLimit))
                chunks.push(chunk(part));
            continue;
        }
        if (currentBytes + sepBytes + paraBytes > byteLimit && currentParts.length > 0) {
            chunks.push(chunk(currentParts.join('\n\n')));
            currentParts = [];
            currentBytes = 0;
        }
        currentParts.push(para);
        currentBytes += (currentBytes > 0 ? sepBytes + paraBytes : paraBytes);
    }
    if (currentParts.length > 0)
        chunks.push(chunk(currentParts.join('\n\n')));
    return chunks.length > 0 ? chunks : [richMessage];
}
/**
 * Split an InputRichMessage into chunks within Telegram's limits (32768 bytes,
 * 500 blocks, 50 media by default). HTML splits at block boundaries recovered
 * from the markup; Markdown splits at blank lines by bytes only.
 */
export function splitRich(richMessage, options) {
    const limits = resolveLimits(options);
    if (richMessage.html !== undefined) {
        return binBlocks(heuristicHtmlBlocks(richMessage.html), limits, richMessage);
    }
    return splitMarkdown(richMessage, limits.byteLimit);
}
/**
 * Convert Markdown into InputRichMessage chunks that each fit Telegram's limits.
 * In html mode the chunks split at the exact block boundaries of the source.
 */
export function telegramifyRich(markdown, options) {
    const limits = resolveLimits(options);
    if ((options?.mode ?? 'html') === 'html') {
        const blocks = new RichHtmlWalker().walkBlocks(walkRichEvents(markdown, options?.latexEscape ?? false));
        return binBlocks(blocks, limits, buildMessage({ html: '' }, options));
    }
    return splitRich(richify(markdown, options), limits);
}

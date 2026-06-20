import { escapeLatex, preprocessSpoilers, validateTelegramEmoji } from './converter.js';
import * as md from '../native/index.js';
export const RICH_BYTE_LIMIT = 32768;
export const RICH_BLOCK_LIMIT = 500;
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
class RichHtmlWalker {
    _parts = [];
    _inlineClosers = [];
    _listStack = [];
    _pendingParagraph = false;
    _paragraphOpen = false;
    _inCodeBlock = false;
    _codeBlockLang = '';
    _codeBlockParts = [];
    _inTable = false;
    _inTableHead = false;
    _inTableCell = false;
    _tableAlignments = [];
    _tableRows = [];
    _currentRow = [];
    _cellParts = [];
    _cellCol = 0;
    _image = null;
    _blockDepth = 0;
    _blocks = [];
    _blockMode = false;
    walk(events) {
        for (const [event, range] of events) {
            this.handleEvent(event);
        }
        this.closeParagraph();
        return this._parts.join('');
    }
    walkBlocks(events) {
        this._blockMode = true;
        for (const [event, range] of events) {
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
        else if ('TaskListMarker' in event)
            this.writeInline(event.TaskListMarker ? '✅ ' : '☑ ');
        else if ('FootnoteReference' in event) {
            const ref = String(event.FootnoteReference);
            const href = escapeHtmlAttr(`#${ref}`);
            const label = escapeHtmlText(`[${ref}]`);
            this.writeInline(`<a href="${href}">${label}</a>`);
        }
    }
    onInlineHtml(value) {
        const tag = value.trim().toLowerCase();
        if (tag === '<tg-spoiler>')
            this.openInline('<tg-spoiler>', '</tg-spoiler>');
        else if (tag === '</tg-spoiler>')
            this.closeInline();
        else
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
            this._cellCol = 0;
        }
        else if (tag === 'TableCell') {
            this._cellParts = [];
            this._inTableCell = true;
        }
        else if (tag === 'HtmlBlock') {
            this.enterBlock();
            this._pendingParagraph = true;
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
                this.emit(`<tg-reference>`);
            }
        }
        else if (tag === 'FootnoteDefinition') {
            this.enterBlock();
            this.closeParagraph();
            this.emit(`<tg-reference>`);
        }
    }
    onEnd(tag) {
        if (tag === 'Strong')
            this.closeInline();
        else if (tag === 'Emphasis')
            this.closeInline();
        else if (tag === 'Strikethrough')
            this.closeInline();
        else if (tag === 'Paragraph') {
            this.closeParagraph();
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
        else if (tag === 'TableRow') {
            this.onEndTableRow();
            this._inTableHead = false;
        }
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
            this.emit('</tg-reference>');
            this.leaveBlock();
        }
        else if (typeof tag === 'object' && tag !== null) {
            if ('Heading' in tag) {
                const level = this._headingLevels.pop() || 1;
                this.emit(`</h${level}>`);
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
    _headingLevels = [];
    onStartHeading(headingData) {
        this.closeParagraph();
        const level = this.headingLevel(headingData);
        this._headingLevels.push(level);
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
        if (image.url.startsWith('http://') || image.url.startsWith('https://')) {
            const attrs = [`src="${escapeHtmlAttr(image.url)}"`, `alt="${escapeHtmlAttr(alt)}"`];
            if (image.title)
                attrs.push(`title="${escapeHtmlAttr(image.title)}"`);
            this.writeInline(`<img ${attrs.join(' ')}/>`);
            return;
        }
        if (image.url) {
            const href = escapeHtmlAttr(image.url);
            const text = escapeHtmlText(alt || image.url);
            this.writeInline(`<a href="${href}">${text}</a>`);
        }
        else {
            this.writeInline(escapeHtmlText(alt));
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
        this._inTable = true;
        this._tableAlignments = Array.isArray(alignments) ? alignments : [];
        this._tableRows = [];
        this.emit('');
    }
    onEndTableCell() {
        const content = this._cellParts.join('');
        this._currentRow.push([content, this._inTableHead]);
        this._cellCol++;
        this._cellParts = [];
        this._inTableCell = false;
    }
    onEndTableRow() {
        if (this._currentRow.length > 0) {
            this._tableRows.push(this._currentRow);
        }
        this._currentRow = [];
        this._cellCol = 0;
    }
    onEndTable() {
        this._inTable = false;
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
        this._blocks.push({
            html: blockHtml,
            byteLen: new TextEncoder().encode(blockHtml).length,
            blockCount: 1,
        });
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
        if (this._pendingParagraph && !this._paragraphOpen && !this._inTableCell) {
            this._parts.push('<p>');
            this._paragraphOpen = true;
        }
        this._pendingParagraph = false;
    }
    closeParagraph() {
        this._pendingParagraph = false;
        if (this._paragraphOpen) {
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
export function richify(markdown, options) {
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
    if (latexEscape)
        preprocessed = escapeLatex(preprocessed);
    preprocessed = preprocessSpoilers(preprocessed);
    const rawEvents = JSON.parse(md.parse(preprocessed, {
        enableStrikethrough: true,
        enableTables: true,
        enableTasklists: true,
        enableMath: true,
        enableGfm: true,
        enableFootnotes: true
    }));
    const walker = new RichHtmlWalker();
    const htmlText = walker.walk(rawEvents);
    return {
        html: htmlText,
        isRtl,
        skipEntityDetection,
    };
}
function htmlFragmentToText(fragment) {
    let text = fragment.replace(/<[^>]*>/g, '');
    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return text;
}
function splitTextByUtf8Bytes(text, byteLimit) {
    if (byteLimit <= 0)
        throw new Error("byteLimit must leave room for wrapper tags");
    const chunks = [];
    let current = '';
    let currentBytes = 0;
    for (const ch of text) {
        const chBytes = Buffer.byteLength(ch, 'utf8');
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
function splitTextByEscapedUtf8Bytes(text, byteLimit) {
    if (byteLimit <= 0)
        throw new Error("byteLimit must leave room for wrapper tags");
    const chunks = [];
    let current = '';
    let currentBytes = 0;
    for (const ch of text) {
        const escapedBytes = Buffer.byteLength(escapeHtmlText(ch), 'utf8');
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
function extractWrappedText(htmlText, tag) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    if (htmlText.startsWith(openTag) && htmlText.endsWith(closeTag)) {
        return htmlText.substring(openTag.length, htmlText.length - closeTag.length);
    }
    return null;
}
function extractPreText(htmlText) {
    const match = htmlText.match(/^(<pre(?:><code[^>]*>|>))(.*?)(<\/code><\/pre>|<\/pre>)$/s);
    if (!match)
        return null;
    return [match[1], match[2], match[3]];
}
function makeBlock(htmlText) {
    return {
        html: htmlText,
        byteLen: Buffer.byteLength(htmlText, 'utf8'),
        blockCount: 1,
    };
}
function splitOversizedBlock(block, byteLimit) {
    const htmlText = block.html;
    const paragraph = extractWrappedText(htmlText, "p");
    if (paragraph !== null) {
        const budget = byteLimit - Buffer.byteLength("<p></p>", 'utf8');
        const parts = splitTextByEscapedUtf8Bytes(htmlFragmentToText(paragraph), budget);
        return parts.filter(p => p).map(p => makeBlock(`<p>${escapeHtmlText(p)}</p>`));
    }
    const pre = extractPreText(htmlText);
    if (pre !== null) {
        const [openTag, content, closeTag] = pre;
        const budget = byteLimit - Buffer.byteLength(openTag + closeTag, 'utf8');
        let unescaped = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const parts = splitTextByEscapedUtf8Bytes(unescaped, budget);
        return parts.filter(p => p).map(p => makeBlock(openTag + escapeHtmlText(p) + closeTag));
    }
    return [];
}
function flushChunk(chunks, blocks, mode, isRtl, skipEntityDetection) {
    const joined = blocks.map(b => b.html).join('');
    if (mode === 'html') {
        chunks.push({ html: joined, isRtl, skipEntityDetection });
    }
    else {
        chunks.push({ markdown: joined, isRtl, skipEntityDetection });
    }
}
function binBlocks(blocks, byteLimit, blockLimit, isRtl, skipEntityDetection, mode) {
    if (blocks.length === 0)
        return [];
    const totalBytes = blocks.reduce((acc, b) => acc + b.byteLen, 0);
    const totalBlocks = blocks.reduce((acc, b) => acc + b.blockCount, 0);
    if (totalBytes <= byteLimit && totalBlocks <= blockLimit) {
        const joined = blocks.map(b => b.html).join('');
        if (mode === 'html') {
            return [{ html: joined, isRtl, skipEntityDetection }];
        }
        else {
            return [{ markdown: joined, isRtl, skipEntityDetection }];
        }
    }
    const chunks = [];
    let currentBlocks = [];
    let currentBytes = 0;
    let currentBlockCount = 0;
    for (const block of blocks) {
        if (block.byteLen > byteLimit) {
            if (currentBlocks.length > 0) {
                flushChunk(chunks, currentBlocks, mode, isRtl, skipEntityDetection);
                currentBlocks = [];
                currentBytes = 0;
                currentBlockCount = 0;
            }
            const splitBlocks = splitOversizedBlock(block, byteLimit);
            if (splitBlocks.length > 0) {
                for (const sb of splitBlocks) {
                    flushChunk(chunks, [sb], mode, isRtl, skipEntityDetection);
                }
            }
            else {
                console.warn(`Single block exceeds byte limit (${block.byteLen} > ${byteLimit}), emitting standalone. Telegram may reject it.`);
                flushChunk(chunks, [block], mode, isRtl, skipEntityDetection);
            }
            continue;
        }
        if (currentBytes + block.byteLen > byteLimit || currentBlockCount + block.blockCount > blockLimit) {
            flushChunk(chunks, currentBlocks, mode, isRtl, skipEntityDetection);
            currentBlocks = [];
            currentBytes = 0;
            currentBlockCount = 0;
        }
        currentBlocks.push(block);
        currentBytes += block.byteLen;
        currentBlockCount += block.blockCount;
    }
    if (currentBlocks.length > 0) {
        flushChunk(chunks, currentBlocks, mode, isRtl, skipEntityDetection);
    }
    return chunks;
}
const BLOCK_TAGS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "pre", "blockquote", "ul", "ol", "table",
    "hr", "tg-math-block", "img", "tg-reference", "details"
]);
function findTagEnd(htmlContent, start, tagName) {
    let pos = start;
    let depth = 0;
    const length = htmlContent.length;
    const regex = new RegExp(`<(\\/?)(${tagName})(?:\\s|>|\\/>)`, 'g');
    regex.lastIndex = pos;
    let match;
    while ((match = regex.exec(htmlContent)) !== null) {
        const isClose = match[1] === '/';
        if (isClose) {
            depth--;
            if (depth === 0) {
                const end = htmlContent.indexOf('>', match.index);
                return end !== -1 ? end + 1 : length;
            }
        }
        else {
            depth++;
        }
    }
    return length;
}
function heuristicHtmlBlocks(htmlContent) {
    const blocks = [];
    let pos = 0;
    const length = htmlContent.length;
    while (pos < length) {
        if (htmlContent[pos] !== '<') {
            let nextTag = htmlContent.indexOf('<', pos);
            if (nextTag === -1) {
                const fragment = htmlContent.substring(pos);
                blocks.push(makeBlock(fragment));
                break;
            }
            pos = nextTag;
            continue;
        }
        const match = htmlContent.substring(pos).match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
        if (!match) {
            let nextTag = htmlContent.indexOf('<', pos + 1);
            if (nextTag === -1)
                nextTag = length;
            const fragment = htmlContent.substring(pos, nextTag);
            blocks.push(makeBlock(fragment));
            pos = nextTag;
            continue;
        }
        const tagName = match[1].toLowerCase();
        if (!BLOCK_TAGS.has(tagName)) {
            const end = findTagEnd(htmlContent, pos, tagName);
            const fragment = htmlContent.substring(pos, end);
            blocks.push(makeBlock(fragment));
            pos = end;
            continue;
        }
        if (tagName === 'hr' || tagName === 'img') {
            let close = htmlContent.indexOf('>', pos);
            if (close === -1)
                close = length - 1;
            const end = close + 1;
            const fragment = htmlContent.substring(pos, end);
            blocks.push(makeBlock(fragment));
            pos = end;
            continue;
        }
        const end = findTagEnd(htmlContent, pos, tagName);
        const fragment = htmlContent.substring(pos, end);
        blocks.push(makeBlock(fragment));
        pos = end;
    }
    return blocks;
}
function splitHtml(richMessage, byteLimit, blockLimit) {
    const htmlContent = richMessage.html;
    const blocks = heuristicHtmlBlocks(htmlContent);
    return binBlocks(blocks, byteLimit, blockLimit, richMessage.isRtl, richMessage.skipEntityDetection, 'html');
}
function splitMarkdown(richMessage, byteLimit, blockLimit) {
    const mdContent = richMessage.markdown;
    if (!mdContent.trim())
        return [];
    if (Buffer.byteLength(mdContent, 'utf8') <= byteLimit) {
        return [richMessage];
    }
    const paragraphs = mdContent.split('\n\n');
    const chunks = [];
    let currentParts = [];
    let currentBytes = 0;
    for (const para of paragraphs) {
        const paraBytes = Buffer.byteLength(para, 'utf8');
        const sepBytes = currentParts.length > 0 ? 2 : 0;
        if (paraBytes > byteLimit) {
            if (currentParts.length > 0) {
                chunks.push({
                    markdown: currentParts.join('\n\n'),
                    isRtl: richMessage.isRtl,
                    skipEntityDetection: richMessage.skipEntityDetection,
                });
                currentParts = [];
                currentBytes = 0;
            }
            for (const part of splitTextByUtf8Bytes(para, byteLimit)) {
                chunks.push({
                    markdown: part,
                    isRtl: richMessage.isRtl,
                    skipEntityDetection: richMessage.skipEntityDetection,
                });
            }
            continue;
        }
        if (currentBytes + sepBytes + paraBytes > byteLimit && currentParts.length > 0) {
            chunks.push({
                markdown: currentParts.join('\n\n'),
                isRtl: richMessage.isRtl,
                skipEntityDetection: richMessage.skipEntityDetection,
            });
            currentParts = [];
            currentBytes = 0;
        }
        currentParts.push(para);
        currentBytes += (currentBytes > 0 ? sepBytes + paraBytes : paraBytes);
    }
    if (currentParts.length > 0) {
        chunks.push({
            markdown: currentParts.join('\n\n'),
            isRtl: richMessage.isRtl,
            skipEntityDetection: richMessage.skipEntityDetection,
        });
    }
    return chunks.length > 0 ? chunks : [richMessage];
}
export function splitRich(richMessage, options) {
    const byteLimit = options?.byteLimit ?? RICH_BYTE_LIMIT;
    const blockLimit = options?.blockLimit ?? RICH_BLOCK_LIMIT;
    if (richMessage.html !== undefined) {
        return splitHtml(richMessage, byteLimit, blockLimit);
    }
    else {
        return splitMarkdown(richMessage, byteLimit, blockLimit);
    }
}
export function telegramifyRich(markdown, options) {
    const rich = richify(markdown, options);
    return splitRich(rich, options);
}

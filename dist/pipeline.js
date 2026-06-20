import { convertWithSegments } from './converter.js';
import { splitEntities, utf16Len } from './entity.js';
import { getFilename } from './codeFile.js';
import { ContentType } from './content.js';
function stripNewlinesAdjust(text, entities) {
    let leading = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n')
            leading++;
        else
            break;
    }
    let trailing = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === '\n')
            trailing++;
        else
            break;
    }
    if (leading === 0 && trailing === 0)
        return { text, entities };
    const end = trailing ? text.length - trailing : text.length;
    const stripped = text.substring(leading, end);
    if (!stripped)
        return { text: stripped, entities: [] };
    const leadingUtf16 = leading;
    const newUtf16Len = utf16Len(stripped);
    const adjusted = [];
    for (const ent of entities) {
        let newOffset = ent.offset - leadingUtf16;
        let newEnd = newOffset + ent.length;
        if (newEnd <= 0 || newOffset >= newUtf16Len)
            continue;
        newOffset = Math.max(0, newOffset);
        newEnd = Math.min(newEnd, newUtf16Len);
        const newLength = newEnd - newOffset;
        if (newLength <= 0)
            continue;
        adjusted.push({
            ...ent,
            offset: newOffset,
            length: newLength,
        });
    }
    return { text: stripped, entities: adjusted };
}
function sliceTextEntities(fullText, fullEntities, pyStart, pyEnd, utf16Start, utf16End) {
    const chunkText = fullText.substring(pyStart, pyEnd);
    const chunkEntities = [];
    for (const ent of fullEntities) {
        const entStart = ent.offset;
        const entEnd = ent.offset + ent.length;
        if (entEnd <= utf16Start || entStart >= utf16End)
            continue;
        const clippedStart = Math.max(entStart, utf16Start);
        const clippedEnd = Math.min(entEnd, utf16End);
        const clippedLength = clippedEnd - clippedStart;
        if (clippedLength <= 0)
            continue;
        chunkEntities.push({
            ...ent,
            offset: clippedStart - utf16Start,
            length: clippedLength,
        });
    }
    return { text: chunkText, entities: chunkEntities };
}
function appendTextChunks(result, text, entities, maxMessageLength) {
    const chunks = splitEntities(text, entities, maxMessageLength);
    for (let { text: chunkText, entities: chunkEntities } of chunks) {
        const res = stripNewlinesAdjust(chunkText, chunkEntities);
        chunkText = res.text;
        chunkEntities = res.entities;
        if (chunkText) {
            result.push({
                text: chunkText,
                entities: chunkEntities,
                contentTrace: { sourceType: 'text' },
                contentType: ContentType.TEXT,
            });
        }
    }
}
function handleCodeBlock(result, seg) {
    const lang = seg.language || '';
    const rawCode = seg.rawCode;
    const fileName = getFilename(rawCode, lang);
    result.push({
        fileName,
        fileData: new TextEncoder().encode(rawCode),
        contentTrace: { sourceType: 'file', extra: { language: lang } },
        captionText: '',
        captionEntities: [],
        contentType: ContentType.FILE,
    });
}
function handleMermaid(result, seg) {
    // Mermaid is skipped based on user request. Fallback to file.
    const rawCode = seg.rawCode;
    result.push({
        fileName: 'mermaid.txt',
        fileData: new TextEncoder().encode(rawCode),
        contentTrace: { sourceType: 'mermaid' },
        captionText: '',
        captionEntities: [],
        contentType: ContentType.FILE,
    });
}
export async function processMarkdown(content, options) {
    const maxMessageLength = options?.maxMessageLength ?? 4096;
    const latexEscape = options?.latexEscape ?? true;
    const renderMermaid = options?.renderMermaid ?? true;
    const minFileLines = options?.minFileLines ?? 1;
    const { text: fullText, entities: fullEntities, segments } = convertWithSegments(content, { latexEscape });
    const result = [];
    const specialSegments = segments.filter((s) => (s.kind === 'code_block' && minFileLines > 0 && s.rawCode.split('\n').length >= minFileLines) ||
        (s.kind === 'mermaid' && renderMermaid));
    specialSegments.sort((a, b) => a.textStart - b.textStart);
    let cursorPy = 0;
    let cursorUtf16 = 0;
    for (const seg of specialSegments) {
        if (seg.textStart > cursorPy) {
            let { text: textChunk, entities: textEntities } = sliceTextEntities(fullText, fullEntities, cursorPy, seg.textStart, cursorUtf16, seg.utf16Start);
            const stripped = stripNewlinesAdjust(textChunk, textEntities);
            if (stripped.text) {
                appendTextChunks(result, stripped.text, stripped.entities, maxMessageLength);
            }
        }
        if (seg.kind === 'mermaid') {
            handleMermaid(result, seg);
        }
        else if (seg.kind === 'code_block') {
            handleCodeBlock(result, seg);
        }
        cursorPy = seg.textEnd;
        cursorUtf16 = seg.utf16End;
    }
    if (cursorPy < fullText.length) {
        let { text: textChunk, entities: textEntities } = sliceTextEntities(fullText, fullEntities, cursorPy, fullText.length, cursorUtf16, utf16Len(fullText));
        const stripped = stripNewlinesAdjust(textChunk, textEntities);
        if (stripped.text) {
            appendTextChunks(result, stripped.text, stripped.entities, maxMessageLength);
        }
    }
    if (result.length === 0 && fullText.trim()) {
        appendTextChunks(result, fullText.trim(), fullEntities, maxMessageLength);
    }
    return result;
}
export async function telegramify(content, options) {
    return processMarkdown(content, options);
}
import { entitiesToMarkdownV2 } from './mdv2.js';
export function markdownify(content, options) {
    const { text, entities } = convertWithSegments(content, { latexEscape: options?.latexEscape });
    return entitiesToMarkdownV2(text, entities);
}

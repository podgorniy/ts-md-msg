export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
  user?: any;
  unix_time?: number;
  date_time_format?: string;
}

/**
 * Returns the length of text measured in UTF-16 code units.
 * In TypeScript/JavaScript, string.length is already the number of UTF-16 code units.
 */
export function utf16Len(text: string): number {
  return text.length;
}

function findNewlinePositions(text: string): number[] {
  const points: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      points.push(i + 1);
    }
  }
  return points;
}

/**
 * Split (text, entities) into chunks not exceeding maxUtf16Len UTF-16 code units.
 * Tries to split at newline boundaries. Entities that span a split boundary
 * are clipped into both chunks.
 */
export function splitEntities(
  text: string,
  entities: MessageEntity[],
  maxUtf16Len: number
): { text: string; entities: MessageEntity[] }[] {
  const total = utf16Len(text);
  if (total <= maxUtf16Len) {
    if (!text.trim()) return [];
    return [{ text, entities: [...entities] }];
  }

  const splitPoints = findNewlinePositions(text);
  const chunksRanges: [number, number][] = [];
  let pyStart = 0;

  while (pyStart < text.length) {
    const utf16Start = pyStart; // since offset == py_index in TS
    const utf16Budget = utf16Start + maxUtf16Len;

    if (text.length <= utf16Budget) {
      chunksRanges.push([pyStart, text.length]);
      break;
    }

    let bestSplit: number | null = null;
    for (const sp of splitPoints) {
      if (sp <= pyStart) continue;
      if (sp <= utf16Budget) {
        bestSplit = sp;
      } else {
        break;
      }
    }

    if (bestSplit === null || bestSplit === pyStart) {
      bestSplit = pyStart + maxUtf16Len;
      if (bestSplit >= text.length) {
        bestSplit = text.length;
      }
    }

    chunksRanges.push([pyStart, bestSplit]);
    pyStart = bestSplit;
  }

  const result: { text: string; entities: MessageEntity[] }[] = [];
  for (const [chunkPyStart, chunkPyEnd] of chunksRanges) {
    const chunkText = text.slice(chunkPyStart, chunkPyEnd);
    const chunkUtf16Start = chunkPyStart;
    const chunkUtf16End = chunkPyEnd;
    const chunkEntities: MessageEntity[] = [];

    for (const ent of entities) {
      const entStart = ent.offset;
      const entEnd = ent.offset + ent.length;

      if (entEnd <= chunkUtf16Start || entStart >= chunkUtf16End) continue;

      const clippedStart = Math.max(entStart, chunkUtf16Start);
      const clippedEnd = Math.min(entEnd, chunkUtf16End);
      const clippedLength = clippedEnd - clippedStart;

      if (clippedLength <= 0) continue;

      chunkEntities.push({
        ...ent,
        offset: clippedStart - chunkUtf16Start,
        length: clippedLength,
      });
    }

    if (chunkText.trim()) {
      result.push({ text: chunkText, entities: chunkEntities });
    }
  }

  return result;
}

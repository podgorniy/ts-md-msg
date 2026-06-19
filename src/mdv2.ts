import { MessageEntity, splitEntities, utf16Len } from './entity.js';

const _MDV2_ESCAPE_CHARS = new Set('_*[]()~`>#+-=|{}.!\\'.split(''));
const _CODE_ESCAPE_CHARS = new Set('`\\'.split(''));
const _URL_ESCAPE_CHARS = new Set(')\\'.split(''));

function escapeMarkdownV2(text: string): string {
  let result = '';
  for (const ch of text) {
    if (_MDV2_ESCAPE_CHARS.has(ch)) result += '\\';
    result += ch;
  }
  return result;
}

function escapeCode(text: string): string {
  let result = '';
  for (const ch of text) {
    if (_CODE_ESCAPE_CHARS.has(ch)) result += '\\';
    result += ch;
  }
  return result;
}

function escapeUrl(url: string): string {
  let result = '';
  for (const ch of url) {
    if (_URL_ESCAPE_CHARS.has(ch)) result += '\\';
    result += ch;
  }
  return result;
}

const _SIMPLE_MARKERS: Record<string, [string, string]> = {
  bold: ['*', '*'],
  italic: ['_', '_'],
  underline: ['__', '__'],
  strikethrough: ['~', '~'],
  spoiler: ['||', '||'],
};

const _CODE_ENTITY_TYPES = new Set(['code', 'pre']);

function getOpenTag(ent: MessageEntity): string {
  if (ent.type in _SIMPLE_MARKERS) return _SIMPLE_MARKERS[ent.type][0];
  if (ent.type === 'code') return '`';
  if (ent.type === 'pre') {
    const lang = ent.language || '';
    if (lang) return `\`\`\`${lang}\n`;
    return '```\n';
  }
  if (ent.type === 'text_link') return '[';
  if (ent.type === 'custom_emoji') return '![';
  if (ent.type === 'date_time') return '![';
  if (ent.type === 'text_mention') return '[';
  return '';
}

function getCloseTag(ent: MessageEntity): string {
  if (ent.type in _SIMPLE_MARKERS) return _SIMPLE_MARKERS[ent.type][1];
  if (ent.type === 'code') return '`';
  if (ent.type === 'pre') return '\n```';
  if (ent.type === 'text_link') {
    const url = escapeUrl(ent.url || '');
    return `](${url})`;
  }
  if (ent.type === 'custom_emoji') {
    const emojiId = ent.custom_emoji_id || '';
    return `](tg://emoji?id=${emojiId})`;
  }
  if (ent.type === 'date_time') {
    const unixTime = ent.unix_time === undefined ? '' : String(ent.unix_time);
    let url = `tg://time?unix=${unixTime}`;
    if (ent.date_time_format !== undefined) {
      url += `&format=${escapeUrl(ent.date_time_format)}`;
    }
    return `](${url})`;
  }
  if (ent.type === 'text_mention') return ']';
  return '';
}

export function entitiesToMarkdownV2(text: string, entities?: MessageEntity[]): string {
  if (!text) return '';
  if (!entities || entities.length === 0) return escapeMarkdownV2(text);

  // In TS/JS, string indices are exactly UTF-16 code units.
  const bqRanges: [number, number, string][] = [];
  const otherEntities: MessageEntity[] = [];

  for (const ent of entities) {
    if (ent.type === 'blockquote' || ent.type === 'expandable_blockquote') {
      bqRanges.push([ent.offset, ent.offset + ent.length, ent.type]);
    } else {
      otherEntities.push(ent);
    }
  }

  function bqAt(idx: number): string | null {
    for (const [s, e, t] of bqRanges) {
      if (idx >= s && idx < e) return t;
    }
    return null;
  }

  function isExpandableStart(idx: number): boolean {
    for (const [s, e, t] of bqRanges) {
      if (idx === s && t === 'expandable_blockquote') return true;
    }
    return false;
  }

  const expandableEndPositions = new Set<number>();
  for (const [s, e, t] of bqRanges) {
    if (t === 'expandable_blockquote') expandableEndPositions.add(e);
  }

  type MEvent = { pos: number; type: number; len: number; seq: number; ent: MessageEntity };
  const events: MEvent[] = [];
  let seq = 0;
  for (const ent of otherEntities) {
    events.push({ pos: ent.offset, type: 1, len: -ent.length, seq, ent });
    events.push({ pos: ent.offset + ent.length, type: 0, len: ent.length, seq: -seq, ent });
    seq++;
  }

  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.type !== b.type) return a.type - b.type;
    if (a.len !== b.len) return a.len - b.len;
    return a.seq - b.seq;
  });

  const eventsByPos: Record<number, MEvent[]> = {};
  for (const event of events) {
    if (!eventsByPos[event.pos]) eventsByPos[event.pos] = [];
    eventsByPos[event.pos].push(event);
  }

  const boundarySet = new Set<number>();
  for (const pos in eventsByPos) boundarySet.add(Number(pos));
  for (const pos of expandableEndPositions) boundarySet.add(pos);
  const boundaryPositions = Array.from(boundarySet).sort((a, b) => a - b);

  const activeCodeEntities = new Set<any>();
  let previousEventClosedPre = false;

  const parts: string[] = [];
  let prevPy = 0;

  if (bqRanges.length > 0) {
    if (isExpandableStart(0)) parts.push('**>');
    else if (bqAt(0) !== null) parts.push('>');
  }

  function emitSegment(segment: string, segStartPy: number) {
    const escapeFn = activeCodeEntities.size > 0 ? escapeCode : escapeMarkdownV2;
    if (bqRanges.length === 0) {
      parts.push(escapeFn(segment));
      return;
    }
    let lineStart = 0;
    for (let i = 0; i < segment.length; i++) {
      if (segment[i] === '\n') {
        parts.push(escapeFn(segment.substring(lineStart, i)));
        parts.push('\n');
        const nextPy = segStartPy + i + 1;
        if (isExpandableStart(nextPy)) parts.push('**>');
        else if (bqAt(nextPy) !== null) parts.push('>');
        lineStart = i + 1;
      }
    }
    if (lineStart < segment.length) {
      parts.push(escapeFn(segment.substring(lineStart)));
    }
  }

  function emitTextBetween(startPy: number, endPy: number, afterPre: boolean) {
    let segment = text.substring(startPy, endPy);
    let segStartPy = startPy;
    if (afterPre && segment.startsWith('\n\n')) {
      segment = segment.substring(1);
      segStartPy += 1;
    }
    if (segment) emitSegment(segment, segStartPy);
  }

  function emitTag(tag: string, posPy: number) {
    if (bqRanges.length === 0 || !tag.includes('\n')) {
      parts.push(tag);
      return;
    }
    let bq = bqAt(posPy);
    if (bq === null && posPy > 0) bq = bqAt(posPy - 1);
    if (bq) parts.push(tag.replace(/\n/g, '\n>'));
    else parts.push(tag);
  }

  for (const pos of boundaryPositions) {
    if (pos > prevPy) {
      emitTextBetween(prevPy, pos, previousEventClosedPre);
      previousEventClosedPre = false;
    }

    let closedPreAtPos = false;
    const posEvents = eventsByPos[pos] || [];
    for (const ev of posEvents) {
      if (ev.type !== 0) continue;
      activeCodeEntities.delete(ev.ent);
      emitTag(getCloseTag(ev.ent), pos);
      if (ev.ent.type === 'pre') closedPreAtPos = true;
    }

    if (expandableEndPositions.has(pos)) {
      parts.push('||');
    }

    for (const ev of posEvents) {
      if (ev.type !== 1) continue;
      if (_CODE_ENTITY_TYPES.has(ev.ent.type)) {
        activeCodeEntities.add(ev.ent);
      }
      emitTag(getOpenTag(ev.ent), pos);
    }

    previousEventClosedPre = closedPreAtPos;
    prevPy = pos;
  }

  if (prevPy < text.length) {
    emitTextBetween(prevPy, text.length, previousEventClosedPre);
  }

  return parts.join('');
}

export function splitMarkdownV2(text: string, entities?: MessageEntity[], maxUtf16Len: number = 4096): string[] {
  if (maxUtf16Len <= 0) throw new Error('maxUtf16Len must be greater than 0');
  if (!text) return [];

  let pending = splitEntities(text, entities || [], maxUtf16Len);
  const chunks: string[] = [];

  while (pending.length > 0) {
    const chunk = pending.shift()!;
    const rendered = entitiesToMarkdownV2(chunk.text, chunk.entities);
    if (utf16Len(rendered) <= maxUtf16Len) {
      chunks.push(rendered);
      continue;
    }

    const plainLen = utf16Len(chunk.text);
    if (plainLen <= 1) throw new Error('A single text unit renders longer than max_utf16_len in MarkdownV2');

    let subLimit = Math.max(1, Math.floor(plainLen / 2));
    let subChunks = splitEntities(chunk.text, chunk.entities, subLimit);
    if (subChunks.length === 1) {
      subLimit = Math.max(1, plainLen - 1);
      subChunks = splitEntities(chunk.text, chunk.entities, subLimit);
    }
    if (subChunks.length === 1) throw new Error('Unable to split MarkdownV2 output within max_utf16_len');

    pending = subChunks.concat(pending);
  }

  return chunks;
}

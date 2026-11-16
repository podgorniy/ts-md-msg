import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamCore } from '../src/stream/core.js';
import {
  DraftStream,
  EntityDraftPayload,
  RichDraftPayload,
  tailByUtf16,
} from '../src/stream/draft.js';
import { EditStream } from '../src/stream/edit.js';
import { convert } from '../src/converter.js';
import { richify, RICH_BYTE_LIMIT } from '../src/rich.js';
import { RenderConfig, getRuntimeConfig } from '../src/config.js';

const trivial = (buf: string) => buf;
const upper = (buf: string) => buf.toUpperCase();
const noop = async () => {};
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('Flag 1: incomplete Markdown', () => {
  it('emits an unclosed fence with CJK and emoji', async () => {
    const emitted: string[] = [];
    const core = new StreamCore({ render: trivial, emit: async (p) => { emitted.push(p); }, finalize: noop, interval: 50 });
    core.feed("```python\ndef hello():\n    print('你好世界 🌍')");
    await advance(100);
    await core.finish();
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]).toContain('你好世界 🌍');
  });

  it('emits unclosed emphasis', async () => {
    const emitted: string[] = [];
    const core = new StreamCore({ render: trivial, emit: async (p) => { emitted.push(p); }, finalize: noop, interval: 50 });
    core.feed('**これは太字で');
    await advance(100);
    await core.finish();
    expect(emitted[0]).toContain('これは太字で');
  });

  it('renders mixed emoji/CJK/ASCII through render', async () => {
    const emitted: string[] = [];
    const core = new StreamCore({ render: upper, emit: async (p) => { emitted.push(p); }, finalize: noop, interval: 50 });
    core.feed('Hello 世界 🎉 テスト');
    await advance(100);
    await core.finish();
    expect(emitted[0]).toContain('HELLO');
    expect(emitted[0]).toContain('世界');
    expect(emitted[0]).toContain('🎉');
  });

  it('convert and richify accept every prefix of a mixed document', () => {
    const doc = '# 标题 🎉\n\n**粗体 *斜体* `code`** שלום עולם\n\n```js\nconst x = "😀";\n```\n\n> quote [link](https://e.com)\n\n- a\n- b ||spoiler||\n';
    for (let i = 0; i <= doc.length; i += 3) {
      const prefix = doc.slice(0, i);
      expect(() => convert(prefix)).not.toThrow();
      expect(() => richify(prefix)).not.toThrow();
    }
  });
});

describe('Flag 2: throttle', () => {
  it('spaces emits at least interval apart', async () => {
    const times: number[] = [];
    const core = new StreamCore({ render: trivial, emit: async () => { times.push(Date.now()); }, finalize: noop, interval: 150 });
    for (let i = 0; i < 20; i++) {
      core.feed(`token${i} `);
      await advance(20);
    }
    await core.finish();
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(150);
    }
  });

  it('absorbs a burst into one emit', async () => {
    let count = 0;
    const core = new StreamCore({ render: trivial, emit: async () => { count++; }, finalize: noop, interval: 200 });
    for (let i = 0; i < 1000; i++) core.feed(`t${i}`);
    await advance(250);
    expect(count).toBe(1);
    await core.finish();
  });
});

describe('Flag 3: keepalive', () => {
  it('re-emits after keepaliveTimeout without tokens', async () => {
    const emitted: number[] = [];
    const core = new StreamCore({
      render: trivial, emit: async () => { emitted.push(Date.now()); }, finalize: noop,
      interval: 50, keepaliveTimeout: 200,
    });
    core.feed('initial content');
    await advance(100);
    const first = emitted.length;
    expect(first).toBe(1);
    await advance(350);
    expect(emitted.length).toBeGreaterThan(first);
    await core.finish();
  });

  it('fires at ~25s with the defaults', async () => {
    const times: number[] = [];
    const start = Date.now();
    const core = new StreamCore({ render: trivial, emit: async () => { times.push(Date.now() - start); }, finalize: noop });
    core.feed('x');
    await advance(26000);
    expect(times.length).toBe(2);
    expect(times[1]).toBeGreaterThanOrEqual(25000);
    expect(times[1]).toBeLessThanOrEqual(26000);
    await core.finish();
  });
});

describe('Flag 4: finalization', () => {
  it('finalizes the full rendered buffer once', async () => {
    const finalized: string[] = [];
    const core = new StreamCore({ render: upper, emit: noop, finalize: async (p) => { finalized.push(p); }, interval: 50 });
    core.feed('hello ');
    core.feed('world');
    await core.finish();
    await core.finish();
    expect(finalized).toEqual(['HELLO WORLD']);
    expect(core.state).toBe('done');
    expect(() => core.feed('more')).toThrow(/done/);
  });

  it('finalizes after many tokens regardless of emit state', async () => {
    const finalized: string[] = [];
    const core = new StreamCore({ render: trivial, emit: noop, finalize: async (p) => { finalized.push(p); }, interval: 50 });
    for (let i = 0; i < 50; i++) core.feed(`token${i} `);
    await advance(150);
    await core.finish();
    expect(finalized[0]).toBe(Array.from({ length: 50 }, (_, i) => `token${i} `).join(''));
  });

  it('skips finalize for an empty buffer', async () => {
    const finalize = vi.fn(noop);
    const core = new StreamCore({ render: trivial, emit: noop, finalize });
    expect(core.state).toBe('idle');
    await core.finish();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('waits for an in-flight emit before finalizing', async () => {
    const log: string[] = [];
    const core = new StreamCore({
      render: trivial,
      emit: async () => { log.push('emit:start'); await new Promise((r) => setTimeout(r, 100)); log.push('emit:end'); },
      finalize: async () => { log.push('final'); },
      interval: 50,
    });
    core.feed('x');
    await advance(60);
    const done = core.finish();
    await advance(100);
    await done;
    expect(log).toEqual(['emit:start', 'emit:end', 'final']);
  });

  it('consume feeds an async iterable then finishes', async () => {
    const finalized: string[] = [];
    const core = new StreamCore({ render: trivial, emit: noop, finalize: async (p) => { finalized.push(p); } });
    async function* tokens() { yield 'a'; yield 'b'; yield 'c'; }
    await core.consume(tokens());
    expect(finalized).toEqual(['abc']);
  });

  it('rejects a non-positive interval', () => {
    expect(() => new StreamCore({ render: trivial, emit: noop, finalize: noop, interval: 0 })).toThrow(/positive/);
  });
});

describe('Flag 5: EditStream interval', () => {
  const opts = { sendMessage: async () => 123, editMessage: noop };

  it('rejects interval < 1000ms', () => {
    expect(() => new EditStream({ ...opts, interval: 500 })).toThrow(/must be >= 1000ms/);
  });

  it('accepts 1000ms and above', () => {
    expect(new EditStream({ ...opts, interval: 1000 })).toBeDefined();
    expect(new EditStream({ ...opts, interval: 2500 })).toBeDefined();
  });

  it('edits no faster than the interval', async () => {
    const times: number[] = [];
    const stream = new EditStream({
      mode: 'entity',
      sendMessage: async () => { times.push(Date.now()); return 1; },
      editMessage: async () => { times.push(Date.now()); },
      interval: 1500,
    });
    for (let i = 0; i < 50; i++) {
      stream.feed(`t${i} `);
      await advance(100);
    }
    await stream.cancel();
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1500);
  });
});

describe('Flag 6: degraded mode', () => {
  it('stops emitting after 3 failures but still finalizes', async () => {
    let emits = 0;
    const finalized: string[] = [];
    const core = new StreamCore({
      render: trivial,
      emit: async () => { emits++; throw new Error('network error'); },
      finalize: async (p) => { finalized.push(p); },
      interval: 50,
    });
    core.feed('content');
    await advance(250);
    core.feed(' more');
    await advance(150);
    await core.finish();
    expect(emits).toBe(3);
    expect(finalized).toEqual(['content more']);
  });

  it('propagates finalize errors', async () => {
    const core = new StreamCore({ render: trivial, emit: noop, finalize: async () => { throw new Error('lost'); } });
    core.feed('x');
    await expect(core.finish()).rejects.toThrow('lost');
  });
});

describe('Flag 7: cancellation', () => {
  it('cancel skips finalize and calls onCancel once', async () => {
    const finalize = vi.fn(noop);
    const onCancel = vi.fn(noop);
    const core = new StreamCore({ render: trivial, emit: noop, finalize, interval: 50, onCancel });
    core.feed('some content');
    await advance(100);
    await core.cancel();
    await core.cancel();
    await core.finish();
    expect(finalize).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('consume cancels and rethrows when the iterable throws', async () => {
    const finalize = vi.fn(noop);
    const onCancel = vi.fn(noop);
    const core = new StreamCore({ render: trivial, emit: noop, finalize, interval: 50, onCancel });
    async function* tokens() { yield 'data'; throw new Error('simulated error'); }
    await expect(core.consume(tokens())).rejects.toThrow('simulated error');
    expect(finalize).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('consume stops quietly when cancelled from outside', async () => {
    const finalize = vi.fn(noop);
    const core = new StreamCore({ render: trivial, emit: noop, finalize, interval: 50 });
    let pulled = 0;
    let returned = false;
    const tokens: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            pulled++;
            await new Promise((r) => setTimeout(r, 10));
            return { value: `t${pulled}`, done: false };
          },
          return: async () => { returned = true; return { value: undefined, done: true }; },
        };
      },
    };
    const run = core.consume(tokens);
    await advance(55);
    await core.cancel();
    await advance(20);
    await run;
    expect(finalize).not.toHaveBeenCalled();
    expect(returned).toBe(true);
    expect(pulled).toBeLessThan(10);
  });

  it('onCancel runs after an in-flight emit settles', async () => {
    const log: string[] = [];
    const core = new StreamCore({
      render: trivial,
      emit: async () => { log.push('emit:start'); await new Promise((r) => setTimeout(r, 100)); log.push('emit:end'); },
      finalize: noop,
      interval: 50,
      onCancel: async () => { log.push('cancel'); },
    });
    core.feed('x');
    await advance(60);
    const done = core.cancel();
    await advance(100);
    await done;
    expect(log).toEqual(['emit:start', 'emit:end', 'cancel']);
  });
});

describe('Flag 8: concurrent send guard', () => {
  it('never overlaps emits', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let emits = 0;
    const core = new StreamCore({
      render: trivial,
      emit: async () => {
        concurrent++;
        emits++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 100));
        concurrent--;
      },
      finalize: noop,
      interval: 30,
    });
    for (let i = 0; i < 10; i++) {
      core.feed(`tok${i} `);
      await advance(20);
    }
    await advance(200);
    await core.finish();
    expect(maxConcurrent).toBe(1);
    expect(emits).toBeGreaterThanOrEqual(1);
    expect(emits).toBeLessThan(10);
  });
});

describe('EditStream', () => {
  it('sends first, then edits the same message, and finalizes with an edit', async () => {
    const sent: unknown[] = [];
    const edited: [number, unknown][] = [];
    const stream = new EditStream({
      mode: 'entity',
      sendMessage: async (p) => { sent.push(p); return 42; },
      editMessage: async (id, p) => { edited.push([id, p]); },
    });
    stream.feed('first');
    await advance(1000);
    expect(stream.messageId).toBe(42);
    expect(sent).toEqual([{ text: 'first', entities: [] }]);
    stream.feed(' **second**');
    await advance(1000);
    expect(edited.length).toBe(1);
    await stream.finish();
    expect(edited.length).toBe(2);
    expect(edited[1]).toEqual([42, { text: 'first second', entities: [{ type: 'bold', offset: 6, length: 6 }] }]);
  });

  it('sends the final payload when nothing was emitted', async () => {
    const sent: unknown[] = [];
    const edit = vi.fn(noop);
    const stream = new EditStream({ sendMessage: async (p) => { sent.push(p); return 7; }, editMessage: edit });
    stream.feed('hi');
    await stream.finish();
    expect(sent).toEqual([{ rich_message: { html: '<p>hi</p>' } }]);
    expect(edit).not.toHaveBeenCalled();
    expect(stream.messageId).toBe(7);
  });
});

describe('DraftStream thinking delay', () => {
  it('sends an empty entity draft first, then real content after the delay', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({
      mode: 'entity', draftId: 5,
      sendDraft: async (p) => { drafts.push(p); },
      sendFinal: noop,
      interval: 50, thinkingDelay: 200,
    });
    stream.feed('hello');
    await advance(100);
    expect(drafts[0]).toEqual({ draft_id: 5, text: '', entities: [] });
    expect(drafts.filter((d) => d.text !== '')).toEqual([]);
    await advance(250);
    expect(drafts.filter((d) => d.text !== '').length).toBeGreaterThanOrEqual(1);
    await stream.finish();
  });

  it('uses <tg-thinking> in rich mode', async () => {
    const drafts: RichDraftPayload[] = [];
    const stream = new DraftStream({ draftId: 9, sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop });
    stream.feed('hello');
    await advance(300);
    expect(drafts[0]).toEqual({ draft_id: 9, rich_message: { html: '<tg-thinking>Thinking...</tg-thinking>' } });
    await advance(800);
    expect(drafts.at(-1)).toEqual({ draft_id: 9, rich_message: { html: '<p>hello</p>' } });
    await stream.finish();
  });

  it('sends content immediately with thinkingDelay null', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({
      mode: 'entity', sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop,
      interval: 50, thinkingDelay: null,
    });
    stream.feed('content');
    await advance(100);
    await stream.finish();
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts.every((d) => d.text === 'content')).toBe(true);
  });
});

describe('DraftStream final message', () => {
  it('finalizes rich mode with the full, unwindowed richify output', async () => {
    const finals: unknown[] = [];
    const stream = new DraftStream({ sendDraft: noop, sendFinal: async (p) => { finals.push(p); } });
    stream.feed('Hello **world**');
    await stream.finish();
    expect(finals).toEqual([{ rich_message: richify('Hello **world**') }]);
  });

  it('finalizes entity mode with text and entities', async () => {
    const finals: unknown[] = [];
    const stream = new DraftStream({ mode: 'entity', sendDraft: noop, sendFinal: async (p) => { finals.push(p); } });
    await stream.consume(['Hello ', '**world**']);
    expect(finals).toEqual([convert('Hello **world**')]);
  });
});

describe('DraftStream cancel', () => {
  it('clears the draft on cancel by default', async () => {
    const drafts: EntityDraftPayload[] = [];
    const sendFinal = vi.fn(noop);
    const stream = new DraftStream({
      mode: 'entity', sendDraft: async (p) => { drafts.push(p); }, sendFinal,
      interval: 50, thinkingDelay: null,
    });
    stream.feed('hi');
    await advance(100);
    await stream.cancel();
    expect(drafts.at(-1)).toMatchObject({ text: '', entities: [] });
    expect(sendFinal).not.toHaveBeenCalled();
  });

  it('clears a rich draft to a placeholder', async () => {
    const drafts: RichDraftPayload[] = [];
    const stream = new DraftStream({ sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop, thinkingDelay: null });
    stream.feed('hi');
    await stream.cancel();
    expect(drafts.at(-1)!.rich_message).toEqual({ html: '<p>…</p>' });
  });

  it('does not clear when cancelClearsDraft is false', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({
      mode: 'entity', sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop,
      interval: 50, thinkingDelay: null, cancelClearsDraft: false,
    });
    stream.feed('hi');
    await advance(100);
    await stream.cancel();
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts.every((d) => d.text === 'hi')).toBe(true);
  });

  it('does not clear by default when keepOnStop is set', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({
      mode: 'entity', sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop,
      interval: 50, thinkingDelay: null, keepOnStop: true,
    });
    stream.feed('hi');
    await advance(100);
    await stream.cancel();
    expect(drafts.every((d) => d.text === 'hi')).toBe(true);
  });

  it('swallows a failing clear', async () => {
    const stream = new DraftStream({ sendDraft: async () => { throw new Error('x'); }, sendFinal: noop });
    stream.feed('hi');
    await expect(stream.cancel()).resolves.toBeUndefined();
  });
});

describe('DraftStream can_stop / keep_on_stop', () => {
  it('adds them to every rich draft, thinking and clear included', async () => {
    const drafts: RichDraftPayload[] = [];
    const stream = new DraftStream({
      draftId: 3, canStop: true, keepOnStop: false, cancelClearsDraft: true,
      sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop, thinkingDelay: 100,
    });
    stream.feed('hi');
    await advance(1000);
    await stream.cancel();
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    for (const d of drafts) {
      expect(d).toMatchObject({ draft_id: 3, can_stop: true, keep_on_stop: false });
    }
  });

  it('adds them to entity drafts', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({
      mode: 'entity', canStop: true, keepOnStop: true,
      sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop, thinkingDelay: 100,
    });
    stream.feed('hi');
    await advance(1000);
    await stream.finish();
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    for (const d of drafts) expect(d).toMatchObject({ can_stop: true, keep_on_stop: true });
  });

  it('omits them when unset', async () => {
    const drafts: EntityDraftPayload[] = [];
    const stream = new DraftStream({ mode: 'entity', sendDraft: async (p) => { drafts.push(p); }, sendFinal: noop });
    stream.feed('hi');
    await advance(1000);
    await stream.finish();
    for (const d of drafts) {
      expect('can_stop' in d).toBe(false);
      expect('keep_on_stop' in d).toBe(false);
    }
  });
});

describe('DraftStream draft id and options', () => {
  it('generates a positive non-zero integer id', () => {
    for (let i = 0; i < 20; i++) {
      const id = new DraftStream({ sendDraft: noop, sendFinal: noop }).draftId;
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    }
  });

  it('rejects draftId 0 and an unknown mode', () => {
    expect(() => new DraftStream({ sendDraft: noop, sendFinal: noop, draftId: 0 })).toThrow(/non-zero/);
    expect(() => new DraftStream({ sendDraft: noop, sendFinal: noop, mode: 'html' as any })).toThrow(/mode/);
    expect(() => new EditStream({ sendMessage: async () => 1, editMessage: noop, mode: 'html' as any })).toThrow(/mode/);
  });
});

describe('DraftStream sliding window', () => {
  const entityRender = (stream: DraftStream<'entity'>, md: string) =>
    (stream as any).render(md) as EntityDraftPayload;
  const richRender = (stream: DraftStream, md: string) =>
    (stream as any).render(md) as RichDraftPayload;

  it('keeps the trailing 4096 UTF-16 units and drops entities', () => {
    const stream = new DraftStream({ mode: 'entity', sendDraft: noop, sendFinal: noop });
    const payload = entityRender(stream, '**bold** ' + 'A'.repeat(5000) + 'Z');
    expect(payload.text.length).toBe(4096);
    expect(payload.text.endsWith('AZ')).toBe(true);
    expect(payload.entities).toEqual([]);
  });

  it('keeps entities under the limit', () => {
    const stream = new DraftStream({ mode: 'entity', sendDraft: noop, sendFinal: noop });
    const payload = entityRender(stream, '**Hello** world');
    expect(payload.text).toBe('Hello world');
    expect(payload.entities).toEqual([{ type: 'bold', offset: 0, length: 5 }]);
  });

  it('counts UTF-16 units and never splits a surrogate pair', () => {
    const stream = new DraftStream({ mode: 'entity', sendDraft: noop, sendFinal: noop });
    expect(entityRender(stream, '😀'.repeat(5000)).text).toBe('😀'.repeat(2048));
    expect(tailByUtf16('a' + '😀'.repeat(5000), 4096)).toBe('😀'.repeat(2048));
    expect(tailByUtf16('a😀'.repeat(3000), 4096)).toBe('a😀'.repeat(1365));
    const odd = tailByUtf16('x' + 'a😀'.repeat(3000), 4095);
    expect(odd.length).toBeLessThanOrEqual(4095);
    expect(odd.charCodeAt(0) >= 0xdc00 && odd.charCodeAt(0) <= 0xdfff).toBe(false);
    expect(tailByUtf16('short', 4096)).toBe('short');
  });

  it('windows rich HTML to the last chunk that fits the limits', () => {
    const stream = new DraftStream({ sendDraft: noop, sendFinal: noop });
    const md = Array.from({ length: 2000 }, (_, i) => `段落 ${i} **粗体** 🎉`).join('\n\n');
    expect(utf8Len(richify(md).html!)).toBeGreaterThan(RICH_BYTE_LIMIT);
    const html = richRender(stream, md).rich_message.html!;
    expect(utf8Len(html)).toBeLessThanOrEqual(RICH_BYTE_LIMIT);
    expect(html.startsWith('<p>')).toBe(true);
    expect(html).not.toContain('�');
    expect(html.endsWith('段落 1999 <b>粗体</b> 🎉</p>')).toBe(true);
  });

  it('leaves small rich HTML untouched', () => {
    const stream = new DraftStream({ sendDraft: noop, sendFinal: noop });
    expect(richRender(stream, 'hi').rich_message).toEqual(richify('hi'));
  });
});

describe('render config', () => {
  let config: RenderConfig;
  let globalMarker: string;

  beforeEach(() => {
    globalMarker = getRuntimeConfig().markdownSymbol.headingLevel1;
    expect(globalMarker).not.toBe('#');
    config = new RenderConfig();
    config.markdownSymbol.headingLevel1 = '#';
  });

  afterEach(() => {
    expect(getRuntimeConfig().markdownSymbol.headingLevel1).toBe(globalMarker);
  });

  it('DraftStream drafts and final use the config', async () => {
    const drafts: EntityDraftPayload[] = [];
    const finals: { text: string }[] = [];
    const stream = new DraftStream({
      mode: 'entity', config, interval: 50, thinkingDelay: null,
      sendDraft: async (p) => { drafts.push(p); },
      sendFinal: async (p) => { finals.push(p); },
    });
    stream.feed('# Title');
    await advance(200);
    await stream.finish();
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts.every((d) => d.text.trim() === '# Title')).toBe(true);
    expect(finals.map((f) => f.text.trim())).toEqual(['# Title']);
  });

  it('EditStream uses the config', async () => {
    const sent: { text: string }[] = [];
    const stream = new EditStream({
      mode: 'entity', config,
      sendMessage: async (p) => { sent.push(p); return 1; },
      editMessage: async (_id, p) => { sent.push(p); },
    });
    stream.feed('# Title');
    await stream.finish();
    expect(sent.map((p) => p.text.trim())).toEqual(['# Title']);
  });
});

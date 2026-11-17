import { describe, expect, it } from 'vitest';
import { convert, isValidTextLinkUrl, markdownify, telegramify, ContentType } from '../src/index.js';

// Every case was sent to the live Bot API as a text_link entity: "accepted"
// means sendMessage succeeded, "rejected" that it failed with "entity URL … is invalid".
const ACCEPTED = [
  'https://example.com',
  'HTTPS://EXAMPLE.COM',
  'http://127.0.0.1',
  'https://t.me/telegram',
  'https://пример.рф',
  'https://xn--e1afmkfd.xn--p1ai',
  'https://example.invalidtldxyz',
  'https://a.b',
  'https://foo_bar.com',
  'https://-a.com',
  'https://a..com',
  'https://.com',
  'https://example.com.',
  'https://ex%61mple.com',
  'https://ex!$mple.com',
  'https://example.com:8080/x',
  'https://user:pass@example.com',
  'https://@example.com',
  'https://[::1]',
  'https://[::1]:80/x',
  'https://example.com#frag',
  'https://example.com?q=a b',
  'https://example.com/a b',
  'https://example.com/path with space?x=<>"',
  'https://example.com/\u0001',
  'https://1.2.3.4.5',
  'https://999.1.1.1',
  `https://${'a'.repeat(300)}.com`,
  'example.com',
  'example.com/path',
  'www.example.com',
  'a@b.co',
  'mailto:a@b.co',
  'tonsite://x.ton',
  'tg://user?id=301347024',
  'tg://resolve?domain=telegram',
  'TG://resolve?domain=x',
  'tg:resolve?domain=x',
  'tg://resolve/path?x=1#f',
  'ton://transfer/x',
];

const REJECTED = [
  '',
  '/guide',
  './guide',
  '//example.com',
  'guide',
  'notadomain',
  '#anchor',
  '?q=1',
  'http://localhost:3000/x',
  'javascript:alert(1)',
  'data:text/plain,hi',
  'tel:+123456',
  'sms:+1',
  'bitcoin:abc',
  'mailto:',
  'mailto:abc',
  'C:\\x',
  'ftp://example.com',
  'file:///etc/passwd',
  'irc://x',
  ' https://example.com',
  'https://example.com ',
  'https://exa mple.com',
  'https://exa\tmple.com',
  'https://',
  'https://a@',
  'https:////example.com',
  'http:/example.com',
  'http:example.com',
  'https://example.com:',
  'https://example.com:0',
  'https://example.com:abc',
  'https://example.com:99999',
  'https://[zz]',
  'https://ex%zzmple.com',
  'https://ex"mple.com',
  'https://ex<mple.com',
  'https://ex^mple.com',
  'https://ex`mple.com',
  'https://ex{mple.com',
  'https://ex|mple.com',
  'https://ex\\mple.com',
  'https://example.com\\@evil.com',
  'tg:',
  'tg://',
  'ton://',
  'tg://res.olve?x',
  'tg://re%41solve',
  'tg://user:p@resolve',
  'tg://resolve:80',
];

describe('isValidTextLinkUrl', () => {
  it.each(ACCEPTED)('accepts %j', (url) => {
    expect(isValidTextLinkUrl(url)).toBe(true);
  });

  it.each(REJECTED)('rejects %j', (url) => {
    expect(isValidTextLinkUrl(url)).toBe(false);
  });
});

describe('Invalid link URLs in entity output', () => {
  it('keeps the text of a relative link and drops the entity', () => {
    const { text, entities } = convert('See [docs](/guide) and [site](https://example.com).');
    expect(text).toBe('See docs and site.');
    expect(entities).toEqual([{ type: 'text_link', offset: 13, length: 4, url: 'https://example.com' }]);
  });

  it.each(['javascript:alert(1)', '#top', 'ftp://example.com', 'http://localhost:3000'])('drops a link to %s', (url) => {
    const { text, entities } = convert(`[link](<${url}>)`);
    expect(text).toBe('link');
    expect(entities).toEqual([]);
  });

  it('keeps formatting inside a dropped link', () => {
    const { text, entities } = convert('[**bold** text](/guide)');
    expect(text).toBe('bold text');
    expect(entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);
  });

  it('keeps scheme-less domains and deep links, which Telegram accepts', () => {
    const { entities } = convert('[a](example.com) [b](tg://resolve?domain=telegram)');
    expect(entities.map((e) => e.url)).toEqual(['example.com', 'tg://resolve?domain=telegram']);
  });

  it('drops an image link with an invalid URL but keeps its symbol and alt text', () => {
    const { text, entities } = convert('![diagram](./img/diagram.png)');
    expect(text).toBe('🖼diagram');
    expect(entities).toEqual([]);
  });

  it('a dropped link inside an image alt does not close the image link', () => {
    const { text, entities } = convert('![see [this](/x) pic](https://example.com/a.png)');
    expect(text).toBe('🖼see this pic');
    expect(entities).toEqual([{ type: 'text_link', offset: 2, length: 12, url: 'https://example.com/a.png' }]);
  });

  it('keeps an empty-URL link as plain text', () => {
    const { text, entities } = convert('[empty]()');
    expect(text).toBe('empty');
    expect(entities).toEqual([]);
  });

  it('telegramify chunks carry no invalid links', async () => {
    const items = await telegramify('Read [the guide](/guide).\n\nThen [this](https://example.com).');
    const entities = items.flatMap((item) => (item.contentType === ContentType.TEXT ? item.entities : []));
    expect(entities.map((e) => e.url)).toEqual(['https://example.com']);
  });

  it('markdownify writes an invalid link as plain text', () => {
    expect(markdownify('[docs](/guide) [site](https://example.com)')).toBe('docs [site](https://example.com)');
  });
});

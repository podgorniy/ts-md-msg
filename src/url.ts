import { isIPv6 } from 'node:net';

/**
 * Telegram validates a `text_link` URL with tdlib's `LinkManager::check_link`
 * and rejects the whole message when one is invalid ("entity URL … is invalid").
 * This is a port of that check (`parse_url` in td/net/HttpUrl.cpp plus the
 * tg:/ton: and host rules), verified against the live Bot API.
 *
 * Rich messages and MarkdownV2 are not affected: Telegram drops an invalid link
 * there and keeps its text.
 */

// RFC 3986 unreserved and sub-delims; tdlib allows these in a host
const HOST_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,;=]$/;
// The same plus ':', for userinfo
const USERINFO_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,;=:]$/;
const HEX = /^[0-9A-Fa-f]{2}$/;

interface ParsedUrl {
  protocol: 'http' | 'https' | 'tonsite';
  userinfo: string;
  host: string;
  port: number;
  isIpv6: boolean;
}

/** True when every character is allowed, percent escapes included; non-ASCII always is. */
function hasOnlyChars(value: string, allowed: RegExp): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '%') {
      if (!HEX.test(value.slice(i + 1, i + 3))) return false;
      i += 2;
    } else if (c.charCodeAt(0) < 0x80 && !allowed.test(c)) {
      return false;
    }
  }
  return true;
}

/** `[scheme://][userinfo@]host[:port][/path][?query][#fragment]`, or null when tdlib rejects it. */
function parseUrl(url: string): ParsedUrl | null {
  let rest = url;
  let protocol: ParsedUrl['protocol'] = 'http';
  const scheme = /^[^:/?#@[\]]*/.exec(url)![0];
  if (url.startsWith('://', scheme.length)) {
    const lower = scheme.toLowerCase();
    if (lower !== 'http' && lower !== 'https' && lower !== 'tonsite') return null;
    protocol = lower;
    rest = url.slice(scheme.length + 3);
  }

  const authority = /^[^/?#]*/.exec(rest)![0];
  // The port is after the last ':' that isn't inside an IPv6 literal or userinfo
  let colon = authority.length - 1;
  while (colon > 0 && authority[colon] !== ':' && authority[colon] !== ']' && authority[colon] !== '@') colon--;
  let userinfoHost = authority;
  let port = 0;
  if (colon > 0 && authority[colon] === ':') {
    const digits = authority.slice(colon + 1).replace(/^0+(?=.)/, '');
    // Empty, non-numeric, 0 and out of range are all "Wrong port number"
    port = /^[0-9]{1,5}$/.test(digits) ? Number(digits) : 0;
    if (port === 0 || port > 65535) return null;
    userinfoHost = authority.slice(0, colon);
  }

  const at = userinfoHost.lastIndexOf('@');
  const userinfo = at < 0 ? '' : userinfoHost.slice(0, at);
  const host = userinfoHost.slice(at + 1);

  let ipv6 = false;
  if (host.startsWith('[') && host.endsWith(']')) {
    if (!isIPv6(host.slice(1, -1))) return null;
    ipv6 = true;
  }
  if (host === '' || host === '.') return null;
  if (!ipv6 && !hasOnlyChars(host, HOST_CHARS)) return null;
  if (!hasOnlyChars(userinfo, USERINFO_CHARS)) return null;

  return { protocol, userinfo, host, port, isIpv6: ipv6 };
}

/**
 * Whether Telegram accepts `url` as the URL of a `text_link` entity.
 *
 * Accepted: http(s) and tonsite URLs whose host has a dot or is an IPv6
 * literal, scheme-less domains (`example.com`, read as http), and `tg:` /
 * `ton:` deep links. Rejected, among others: relative URLs (`/guide`,
 * `#anchor`), `javascript:`, `ftp:`, `tel:`, `localhost`, and bad ports.
 */
export function isValidTextLinkUrl(url: string): boolean {
  let link = url;
  const lower = url.toLowerCase();
  const deep = lower.startsWith('tg:') || lower.startsWith('ton:');
  if (deep) {
    link = url.slice(lower.startsWith('tg:') ? 3 : 4);
    if (link.startsWith('//')) link = link.slice(2);
  }

  const parsed = parseUrl(link);
  if (!parsed) return false;

  if (deep) {
    if (link.toLowerCase().startsWith('http://') || parsed.protocol !== 'http') return false;
    if (parsed.userinfo !== '' || parsed.port !== 0 || parsed.isIpv6) return false;
    return /^[A-Za-z0-9_-]+$/.test(parsed.host);
  }
  return parsed.isIpv6 || parsed.host.includes('.');
}

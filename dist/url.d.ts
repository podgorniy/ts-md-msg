/**
 * Whether Telegram accepts `url` as the URL of a `text_link` entity.
 *
 * Accepted: http(s) and tonsite URLs whose host has a dot or is an IPv6
 * literal, scheme-less domains (`example.com`, read as http), and `tg:` /
 * `ton:` deep links. Rejected, among others: relative URLs (`/guide`,
 * `#anchor`), `javascript:`, `ftp:`, `tel:`, `localhost`, and bad ports.
 */
export declare function isValidTextLinkUrl(url: string): boolean;

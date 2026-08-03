const FALLBACK = '/leagues';

// Same-origin relative paths only. Rejects absolute URLs, protocol-relative
// `//host`, and backslashes (browsers normalize `/\` to `//` in Location headers).
export function safeCallbackUrl(url: unknown): string {
    if (typeof url !== 'string') return FALLBACK;
    if (!/^\/(?!\/)/.test(url) || url.includes('\\')) return FALLBACK;
    return url;
}

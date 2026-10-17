const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal base64 encoder for ASCII byte strings (used for HTTP Basic auth). */
export function b64encode(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i) & 0xff;
    const has2 = i + 1 < input.length;
    const has3 = i + 2 < input.length;
    const c2 = has2 ? input.charCodeAt(i + 1) & 0xff : 0;
    const c3 = has3 ? input.charCodeAt(i + 2) & 0xff : 0;
    out += CHARS[c1 >> 2];
    out += CHARS[((c1 & 0x03) << 4) | (c2 >> 4)];
    out += has2 ? CHARS[((c2 & 0x0f) << 2) | (c3 >> 6)] : '=';
    out += has3 ? CHARS[c3 & 0x3f] : '=';
  }
  return out;
}

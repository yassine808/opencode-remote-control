const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal base64 codec (encoder: Basic auth headers; decoder: camera JPEG payloads). */
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

const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

/** Decode base64 into bytes; padding, whitespace, and junk are simply skipped. */
export function b64decode(input: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const v = LOOKUP[input.charCodeAt(i)];
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

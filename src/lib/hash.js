// Small stable string hash (FNV-1a, 32 bit) for idempotency refs. Not for security.
export function hashText(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? '').trim().toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Sortable-ish random identifier: prefix_<time><random>. */
export function newId(prefix: string, randomBytesCount = 10): string {
  const time = Date.now().toString(32).padStart(9, '0');
  const random = encodeBase32(randomBytes(randomBytesCount));
  return `${prefix}_${time}${random}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function shortCode(bytes = 4): string {
  return encodeBase32(randomBytes(bytes)).slice(0, 6);
}

import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  hashToken,
  safeEqual,
  signServiceRequest,
  verifyPassword,
  verifyServiceRequest,
} from '../src/lib/crypto.js';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password entirely', hash)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal values', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('never returns the raw token', () => {
    expect(hashToken('secret-token')).not.toContain('secret-token');
  });
});

describe('service request signatures', () => {
  it('accepts an untampered request', () => {
    const signed = signServiceRequest('POST', '/public/submissions', '{"a":1}');
    expect(
      verifyServiceRequest(
        'POST',
        '/public/submissions',
        '{"a":1}',
        signed.timestamp,
        signed.signature,
      ),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signed = signServiceRequest('POST', '/public/submissions', '{"a":1}');
    expect(
      verifyServiceRequest(
        'POST',
        '/public/submissions',
        '{"a":2}',
        signed.timestamp,
        signed.signature,
      ),
    ).toBe(false);
  });

  it('rejects a tampered path or method', () => {
    const signed = signServiceRequest('POST', '/public/submissions', '{}');
    expect(
      verifyServiceRequest('GET', '/public/submissions', '{}', signed.timestamp, signed.signature),
    ).toBe(false);
    expect(
      verifyServiceRequest('POST', '/admin/stats', '{}', signed.timestamp, signed.signature),
    ).toBe(false);
  });

  it('rejects missing or stale credentials', () => {
    const signed = signServiceRequest('GET', '/admin/stats', '');
    expect(verifyServiceRequest('GET', '/admin/stats', '', undefined, signed.signature)).toBe(
      false,
    );
    expect(verifyServiceRequest('GET', '/admin/stats', '', signed.timestamp, undefined)).toBe(
      false,
    );
    expect(
      verifyServiceRequest(
        'GET',
        '/admin/stats',
        '',
        String(Math.floor(Date.now() / 1000) - 10_000),
        signed.signature,
      ),
    ).toBe(false);
  });
});

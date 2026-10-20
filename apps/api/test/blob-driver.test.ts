import { beforeEach, describe, expect, it, vi } from 'vitest';

// The driver is the only thing under test; keep Vercel Blob entirely in memory.
vi.mock('@vercel/blob', () => {
  class BlobError extends Error {}
  class BlobAccessError extends BlobError {}
  class BlobStoreSuspendedError extends BlobError {}
  class BlobServiceRateLimited extends BlobError {
    retryAfter = 60;
  }
  return {
    put: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    BlobError,
    BlobAccessError,
    BlobStoreSuspendedError,
    BlobServiceRateLimited,
  };
});

import { put } from '@vercel/blob';
import { BlobDriver } from '../src/services/storage.js';

const putMock = vi.mocked(put);

/** The exact wording Vercel Blob uses when a store was created as private. */
const PRIVATE_REJECTION =
  'Vercel Blob: Cannot use public access on a private store. The store is configured with private access.';

describe('BlobDriver access mode', () => {
  beforeEach(() => {
    putMock.mockReset();
  });

  it('adopts private access and retries when a private store rejects the public write', async () => {
    putMock.mockRejectedValueOnce(new Error(PRIVATE_REJECTION));
    putMock.mockResolvedValueOnce({
      url: 'https://store.private.blob.vercel-storage.com/uploads/photos/a.webp',
      pathname: 'uploads/photos/a.webp',
      contentType: 'image/webp',
    } as never);

    const driver = new BlobDriver('blob-token', 'public');
    const stored = await driver.put('uploads/photos/a.webp', Buffer.from('pixels'), {
      contentType: 'image/webp',
    });

    expect(putMock).toHaveBeenCalledTimes(2);
    expect(putMock.mock.calls[0]?.[2]?.access).toBe('public');
    expect(putMock.mock.calls[1]?.[2]?.access).toBe('private');
    expect(driver.store).toBe('private');
    expect(stored.store).toBe('private');
    expect(stored.url).toBe('https://store.private.blob.vercel-storage.com/uploads/photos/a.webp');
  });

  it('retries both writes when concurrent uploads race the access-mode switch', async () => {
    // Both writes leave the driver while it still believes the store is public,
    // so both are rejected. The second catch already sees access=private; it must
    // still retry, or the thumbnail write fails and takes the upload down with it.
    putMock.mockImplementation((async (
      key: string,
      _body: Buffer,
      options: { access?: string },
    ) => {
      if (options?.access !== 'private') throw new Error(PRIVATE_REJECTION);
      return {
        url: `https://store.private.blob.vercel-storage.com/${key}`,
        pathname: key,
        contentType: 'image/webp',
      };
    }) as never);

    const driver = new BlobDriver('blob-token', 'public');
    const [full, thumb] = await Promise.all([
      driver.put('uploads/photos/a.webp', Buffer.from('pixels'), { contentType: 'image/webp' }),
      driver.put('uploads/photos/a-thumb.webp', Buffer.from('thumb'), {
        contentType: 'image/webp',
      }),
    ]);

    expect(putMock).toHaveBeenCalledTimes(4);
    expect(full.store).toBe('private');
    expect(thumb.store).toBe('private');
    expect(driver.store).toBe('private');
  });

  it('does not retry unrelated write failures', async () => {
    putMock.mockRejectedValueOnce(new Error('Vercel Blob: quota exceeded for this store'));

    const driver = new BlobDriver('blob-token', 'public');
    await expect(
      driver.put('uploads/photos/a.webp', Buffer.from('pixels'), { contentType: 'image/webp' }),
    ).rejects.toThrow(/quota exceeded/);

    expect(driver.store).toBe('public');
    expect(putMock).toHaveBeenCalledTimes(1);
  });
});

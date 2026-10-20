/** Browser-side photo upload: BFF ticket -> direct PUT to the Render API. */

export interface UploadTicket {
  uploadId: string;
  token: string;
  uploadUrl: string;
  expiresAt?: string;
}

export class UploadError extends Error {
  readonly code: string;

  constructor(message: string, code = 'UPLOAD_FAILED') {
    super(message);
    this.name = 'UploadError';
    this.code = code;
  }
}

async function readError(response: Response, fallback: string): Promise<UploadError> {
  try {
    const payload = (await response.json()) as { error?: { message?: string; code?: string } };
    return new UploadError(
      payload.error?.message || fallback,
      payload.error?.code ?? 'UPLOAD_FAILED',
    );
  } catch {
    return new UploadError(fallback);
  }
}

/** Ask the newsroom for single-use upload tickets. */
export async function requestUploadTickets(
  files: Array<{ name: string; type: string; size: number }>,
): Promise<UploadTicket[]> {
  if (files.length === 0) return [];
  const response = await fetch('/api/public/uploads/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!response.ok) {
    throw await readError(response, 'Could not prepare the photo upload. Try again.');
  }
  const payload = (await response.json()) as { tickets?: UploadTicket[] };
  return Array.isArray(payload.tickets) ? payload.tickets : [];
}

/**
 * PUT the bytes straight to Render. XHR is used (not fetch) because upload
 * progress events are what make a slow phone upload tolerable.
 */
export function putUpload(
  ticket: UploadTicket,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', ticket.uploadUrl, true);
    request.setRequestHeader('Authorization', `Bearer ${ticket.token}`);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        let message = 'The photo upload failed.';
        try {
          const parsed = JSON.parse(request.responseText) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          // Non-JSON error body (proxy timeouts) - keep the friendly default.
        }
        reject(new UploadError(message, 'UPLOAD_FAILED'));
      }
    });

    request.addEventListener('error', () => {
      reject(new UploadError('Network error while uploading the photo.', 'UPLOAD_NETWORK'));
    });

    request.addEventListener('abort', () => {
      reject(new UploadError('Upload cancelled.', 'UPLOAD_ABORTED'));
    });

    request.send(file);
  });
}

/** Allowed image types, mirrored from the API content-type parsers. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function isAcceptedImage(file: File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

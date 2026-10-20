import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';

export const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);
export const MAX_INPUT_PIXELS = 60_000_000;

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  mime: 'image/webp';
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  checksum: string;
  originalBytes: number;
  /** Format detected from the bytes themselves, not from the upload header. */
  format: 'jpeg' | 'png' | 'webp';
  originalMime: string;
}

const ORIGINAL_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ImageProcessOptions {
  maxDimension?: number;
  thumbWidth?: number;
  quality?: number;
}

/**
 * Re-encode every upload: validates the real format, applies EXIF rotation,
 * strips all metadata (GPS, device, faces) and produces a thumbnail.
 */
export async function processImage(
  buffer: Buffer,
  options: ImageProcessOptions = {},
): Promise<ProcessedImage> {
  if (buffer.byteLength === 0) throw badRequest('Empty image file.', 'IMAGE_EMPTY');

  const maxDimension = options.maxDimension ?? 2000;
  const thumbWidth = options.thumbWidth ?? 720;
  const quality = options.quality ?? 82;

  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    });
  } catch {
    throw badRequest('File is not a readable image.', 'IMAGE_UNREADABLE');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw badRequest('File is not a readable image.', 'IMAGE_UNREADABLE');
  }

  if (!metadata.format || !ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
    throw badRequest('Photos must be JPEG, PNG or WebP.', 'IMAGE_UNSUPPORTED_FORMAT');
  }
  if (!metadata.width || !metadata.height) {
    throw badRequest('Image dimensions could not be read.', 'IMAGE_UNREADABLE');
  }
  if (metadata.width < 64 || metadata.height < 64) {
    throw badRequest('Image is too small (minimum 64x64).', 'IMAGE_TOO_SMALL');
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw badRequest('Image resolution is too large.', 'IMAGE_TOO_LARGE');
  }

  const base = sharp(buffer, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: 'error',
    animated: false,
  })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });

  let full: Buffer;
  let info: sharp.OutputInfo;
  try {
    const result = await base
      .clone()
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    full = result.data;
    info = result.info;
  } catch {
    throw badRequest('Image could not be processed.', 'IMAGE_PROCESSING_FAILED');
  }

  let thumb: Buffer;
  let thumbInfo: sharp.OutputInfo;
  try {
    const result = await sharp(full)
      .resize({ width: thumbWidth, withoutEnlargement: true })
      .webp({ quality: 72, effort: 3 })
      .toBuffer({ resolveWithObject: true });
    thumb = result.data;
    thumbInfo = result.info;
  } catch {
    throw badRequest('Thumbnail could not be generated.', 'IMAGE_PROCESSING_FAILED');
  }

  const format = metadata.format as 'jpeg' | 'png' | 'webp';

  return {
    full,
    thumb,
    mime: 'image/webp',
    width: info.width,
    height: info.height,
    thumbWidth: thumbInfo.width,
    thumbHeight: thumbInfo.height,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    originalBytes: buffer.byteLength,
    format,
    originalMime: ORIGINAL_MIME[format] ?? 'application/octet-stream',
  };
}

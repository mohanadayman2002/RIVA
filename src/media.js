import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { fetchMedia } from './whatsapp.js';
import { isEnabled, uploadImage } from './supabase.js';

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

export const MIME_BY_EXT = {
  ...Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime])),
  // image/jpg is not a real media type; the reverse map would otherwise pick it
  '.jpg': 'image/jpeg',
};

export function extForMime(mime) {
  return EXT_BY_MIME[String(mime).toLowerCase()] || '.jpg';
}

/**
 * Bytes supplied locally (browser simulator) instead of fetched from the Cloud
 * API. Consumed once, by media id.
 */
const stash = new Map();

export function stashMedia(mediaId, { buffer, mimeType }) {
  stash.set(mediaId, { buffer, mimeType });
}

/**
 * Downloads a WhatsApp media object into data/uploads/<runId>/ and returns a
 * store-relative path (what the presentation and the /media route use).
 */
export async function saveIncomingMedia({ runId, mediaId, mimeType, filename: forcedName }) {
  const stashed = stash.get(mediaId);
  if (stashed) stash.delete(mediaId);

  const { buffer, mimeType: actualMime } = stashed || (await fetchMedia(mediaId));
  const mime = actualMime || mimeType || 'image/jpeg';
  const filename = forcedName || `${mediaId}${extForMime(mime)}`;

  // Same "<runId>/<filename>" shape either way, so everything downstream — the
  // presentation page, the /media route, the spreadsheet — stays identical.
  if (isEnabled()) {
    await uploadImage({ runId, filename, buffer, mimeType: mime });
  } else {
    const dir = path.join(config.uploadsDir, runId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, filename), buffer);
  }

  return {
    id: mediaId,
    rel: `${runId}/${filename}`,
    mimeType: mime,
    bytes: buffer.length,
  };
}

/**
 * Guards the /media route: only ever resolve inside the uploads directory.
 */
export function resolveUpload(relPath) {
  const target = path.resolve(config.uploadsDir, relPath);
  const rootWithSep = config.uploadsDir.endsWith(path.sep)
    ? config.uploadsDir
    : config.uploadsDir + path.sep;
  if (!target.startsWith(rootWithSep)) return null;
  return target;
}

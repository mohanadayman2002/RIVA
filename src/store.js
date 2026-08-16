/**
 * Storage facade.
 *
 * With SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set, everything lives in
 * Postgres and Supabase Storage. Without them it falls back to a JSON file and
 * the local uploads folder, so /sim and `npm run demo` still run offline.
 *
 * The API is async either way — the file backend just resolves immediately.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as remote from './supabase.js';

export const usingSupabase = remote.isEnabled();

export function describeBackend() {
  return usingSupabase
    ? `supabase ${new URL(config.supabase.url).hostname.split('.')[0]} (bucket: ${config.supabase.bucket})`
    : `local json store (${config.dbFile})`;
}

export function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ==========================================================================
// local JSON backend
// ==========================================================================

const empty = { sessions: {}, presentations: {} };
let db = structuredClone(empty);
let flushTimer = null;
let flushing = null;

fs.mkdirSync(config.uploadsDir, { recursive: true });

if (!usingSupabase) {
  try {
    db = { ...structuredClone(empty), ...JSON.parse(fs.readFileSync(config.dbFile, 'utf8')) };
  } catch {
    // first run — keep the empty db
  }
}

async function flush() {
  const tmp = `${config.dbFile}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fsp.rename(tmp, config.dbFile);
}

function scheduleFlush() {
  if (usingSupabase || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushing = flush().catch((err) => console.error('[store] flush failed:', err));
  }, 150);
  flushTimer.unref?.();
}

export async function flushNow() {
  if (usingSupabase) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushing;
  await flush();
}

// ==========================================================================
// sessions
// ==========================================================================

export async function getSession(waId) {
  if (usingSupabase) return remote.getSession(waId);
  return db.sessions[waId] || null;
}

export async function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  if (usingSupabase) return remote.saveSession(session);

  db.sessions[session.id] = session;
  scheduleFlush();
  return session;
}

export async function resetSession(waId, profileName) {
  const previous = await getSession(waId);
  const session = {
    id: waId,
    profileName: profileName || previous?.profileName || '',
    runId: newId(6),
    lang: previous?.lang || 'en',
    step: 'IDLE',
    images: [],
    floorplans: [],
    text: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveSession(session);
}

// ==========================================================================
// presentations
// ==========================================================================

export async function savePresentation(presentation) {
  if (usingSupabase) return remote.savePresentation(presentation);

  db.presentations[presentation.id] = presentation;
  scheduleFlush();
  return presentation;
}

export async function getPresentation(id) {
  if (usingSupabase) return remote.getPresentation(id);
  return db.presentations[id] || null;
}

export async function listPresentations(limit = 50) {
  if (usingSupabase) return remote.listPresentations(limit);

  return Object.values(db.presentations)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function bumpViews(id) {
  if (usingSupabase) return remote.bumpViews(id);

  const p = db.presentations[id];
  if (!p) return;
  p.views = (p.views || 0) + 1;
  p.lastViewedAt = new Date().toISOString();
  scheduleFlush();
}

export function uploadPath(...parts) {
  return path.join(config.uploadsDir, ...parts);
}

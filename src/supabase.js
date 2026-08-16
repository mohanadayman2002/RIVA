/**
 * Supabase-backed store: submissions, their images, and in-progress sessions.
 *
 * Mirrors the function signatures of store.js so flow.js and server.js do not
 * care which backend is live. When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 * blank, isEnabled() is false and the app keeps using the local JSON store.
 *
 * Rows carry the phone number, so a submission's text, its photos and the number
 * that sent them stay joined by submission_id.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client = null;

export function isEnabled() {
  return Boolean(config.supabase.url && config.supabase.serviceKey);
}

function db() {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const BUCKET = () => config.supabase.bucket;

// ---------------------------------------------------------------- storage

/**
 * Uploads one image and returns its storage path. Paths carry the random run id,
 * so a public bucket still yields unguessable urls.
 */
export async function uploadImage({ runId, filename, buffer, mimeType }) {
  const storagePath = `${runId}/${filename}`;
  const { error } = await db()
    .storage.from(BUCKET())
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return storagePath;
}

export function publicUrl(storagePath) {
  const { data } = db().storage.from(BUCKET()).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ---------------------------------------------------------------- sessions

const SESSION_COLUMNS = 'wa_id, profile_name, step, run_id, lang, message, images, floorplans';

/** Shapes a database row like the session object the flow works with. */
function toSession(row) {
  if (!row) return null;
  return {
    id: row.wa_id,
    profileName: row.profile_name || '',
    step: row.step,
    runId: row.run_id,
    lang: row.lang || 'en',
    text: row.message || '',
    images: row.images || [],
    floorplans: row.floorplans || [],
  };
}

export async function getSession(waId) {
  const { data, error } = await db()
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('wa_id', waId)
    .maybeSingle();

  if (error) throw new Error(`session read failed: ${error.message}`);
  return toSession(data);
}

export async function saveSession(session) {
  const { error } = await db().from('sessions').upsert(
    {
      wa_id: session.id,
      profile_name: session.profileName || '',
      step: session.step,
      run_id: session.runId,
      lang: session.lang || 'en',
      message: session.text || '',
      images: session.images || [],
      floorplans: session.floorplans || [],
    },
    { onConflict: 'wa_id' },
  );

  if (error) throw new Error(`session write failed: ${error.message}`);
  return session;
}

// ---------------------------------------------------------------- submissions

/**
 * Writes the submission and its image rows together. The images are inserted in
 * the order the agent sent them, with their position preserved.
 */
export async function savePresentation(presentation) {
  const { error: submissionError } = await db().from('submissions').upsert(
    {
      id: presentation.id,
      created_at: presentation.createdAt,
      wa_id: presentation.waId,
      phone: presentation.phone,
      profile_name: presentation.profileName || '',
      message: presentation.text || '',
      run_id: presentation.runId,
      views: presentation.views || 0,
    },
    { onConflict: 'id' },
  );
  if (submissionError) throw new Error(`submission write failed: ${submissionError.message}`);

  const rows = [
    ...(presentation.images || []).map((storagePath, i) => ({
      submission_id: presentation.id,
      kind: 'photo',
      position: i + 1,
      storage_path: storagePath,
    })),
    ...(presentation.floorplans || []).map((storagePath, i) => ({
      submission_id: presentation.id,
      kind: 'floorplan',
      position: i + 1,
      storage_path: storagePath,
    })),
  ];

  if (rows.length) {
    const { error } = await db()
      .from('submission_images')
      .upsert(rows, { onConflict: 'submission_id,kind,position' });
    if (error) throw new Error(`image rows write failed: ${error.message}`);
  }

  return presentation;
}

/** Rebuilds the presentation shape the renderer expects. */
function toPresentation(row) {
  const images = (row.submission_images || [])
    .slice()
    .sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    createdAt: row.created_at,
    waId: row.wa_id,
    phone: row.phone,
    profileName: row.profile_name || '',
    text: row.message || '',
    runId: row.run_id,
    views: row.views || 0,
    lastViewedAt: row.last_viewed_at,
    images: images.filter((i) => i.kind === 'photo').map((i) => i.storage_path),
    floorplans: images.filter((i) => i.kind === 'floorplan').map((i) => i.storage_path),
    brand: { ...config.brand },
  };
}

const WITH_IMAGES = '*, submission_images(kind, position, storage_path)';

export async function getPresentation(id) {
  const { data, error } = await db().from('submissions').select(WITH_IMAGES).eq('id', id).maybeSingle();
  if (error) throw new Error(`submission read failed: ${error.message}`);
  return data ? toPresentation(data) : null;
}

export async function listPresentations(limit = 50) {
  const { data, error } = await db()
    .from('submissions')
    .select(WITH_IMAGES)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`submission list failed: ${error.message}`);
  return (data || []).map(toPresentation);
}

/** Fire-and-forget: a failed view counter must never break the page. */
export async function bumpViews(id) {
  const { error } = await db().rpc('increment_submission_views', { submission_id: id });
  if (!error) return;

  // no rpc installed — fall back to read-modify-write
  const { data } = await db().from('submissions').select('views').eq('id', id).maybeSingle();
  await db()
    .from('submissions')
    .update({ views: (data?.views || 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('id', id);
}

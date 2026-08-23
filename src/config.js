import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, 'data');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),

  // Public URL of this server (ngrok / your domain). Used to build the link we send back.
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),

  // --- WhatsApp Cloud API ---
  graphBaseUrl: (process.env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
  graphVersion: process.env.GRAPH_VERSION || 'v22.0',
  token: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'riva-verify',
  // optional — only used by `npm run check:whatsapp` to read the subscription
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',

  // --- Supabase (falls back to the local JSON store when url/key are blank) ---
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'listings',
  },

  // --- Storage ---
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),

  // --- Branding shown on the presentation ---
  brand: {
    name: process.env.BRAND_NAME || 'RIVA Properties',
    tagline: process.env.BRAND_TAGLINE || '',
    agent: process.env.BRAND_AGENT || '',
    phone: process.env.BRAND_PHONE || '',
    // shown top-left on every presentation
    mark: process.env.BRAND_MARK ?? 'CG',
  },

  // Browser chat simulator at /sim — set SIMULATOR=off in production
  simulator: process.env.SIMULATOR !== 'off',

  // People type slower than they attach photos, so the text step waits longer
  textIdleMs: Number(process.env.TEXT_IDLE_MS || 45000),

  // How long to wait after the last photo before assuming the user is done (ms)
  batchIdleMs: Number(process.env.BATCH_IDLE_MS || 8000),

};

export function assertWhatsAppConfig() {
  const missing = [];
  if (!config.token) missing.push('WHATSAPP_TOKEN');
  if (!config.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  return missing;
}

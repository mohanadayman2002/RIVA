import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { config, assertWhatsAppConfig } from './config.js';
import { readMessage, markRead } from './whatsapp.js';
import { handleIncoming } from './flow.js';
import { getPresentation, bumpViews, listPresentations, usingSupabase, describeBackend } from './store.js';
import { renderPresentation, renderNotFound } from './render.js';
import { resolveUpload, MIME_BY_EXT } from './media.js';
import { publicUrl } from './supabase.js';
import { mountSimulator } from './sim.js';
import { workbookBuffer } from './excel.js';

// Cloud API retries deliveries; keep a small window of seen message ids.
const seen = new Set();
const seenOrder = [];
function alreadyHandled(id) {
  if (seen.has(id)) return true;
  seen.add(id);
  seenOrder.push(id);
  if (seenOrder.length > 500) seen.delete(seenOrder.shift());
  return false;
}

function verifySignature(req) {
  if (!config.appSecret) return true; // not configured — dev mode
  const header = req.get('x-hub-signature-256') || '';
  const expected =
    'sha256=' + crypto.createHmac('sha256', config.appSecret).update(req.body).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  // Deployed behind a platform proxy (Railway, Render, Fly, Coolify…), so trust
  // the forwarding headers for client ip and protocol.
  app.set('trust proxy', true);

  // ---------------------------------------------------------------- webhook
  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === config.verifyToken) {
      console.log('[webhook] verified');
      return res.status(200).send(String(challenge));
    }
    return res.sendStatus(403);
  });

  app.post('/webhook', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!verifySignature(req)) {
      console.warn('[webhook] bad signature');
      return res.sendStatus(401);
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    // Ack immediately — Meta retries anything slower than a few seconds.
    res.sendStatus(200);

    setImmediate(() => processPayload(payload).catch((err) => console.error('[webhook]', err)));
  });

  // ---------------------------------------------------------------- simulator
  if (config.simulator) mountSimulator(app);

  // ---------------------------------------------------------------- presentation
  app.get('/p/:id', async (req, res) => {
    let presentation;
    try {
      presentation = await getPresentation(req.params.id);
    } catch (err) {
      console.error('[page]', err.message);
      return res.sendStatus(500);
    }
    if (!presentation) {
      return res.status(404).type('html').send(renderNotFound());
    }
    bumpViews(presentation.id).catch((err) => console.error('[views]', err.message));
    res.type('html').send(renderPresentation(presentation, { baseUrl: config.baseUrl }));
  });

  // ---------------------------------------------------------------- media
  app.use('/media', async (req, res) => {
    const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!rel) return res.sendStatus(404);

    // With Supabase the bytes live in the storage bucket. Keeping the /media
    // path and redirecting means presentation links and spreadsheet links keep
    // one stable shape regardless of which backend is behind them.
    if (usingSupabase) {
      return res.redirect(302, publicUrl(rel));
    }

    const file = resolveUpload(rel);
    if (!file) return res.sendStatus(403);

    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) return res.sendStatus(404);

      res.setHeader('Content-Type', MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(file).pipe(res);
    } catch {
      res.sendStatus(404);
    }
  });

  // ---------------------------------------------------------------- export
  app.get('/export.xlsx', async (_req, res) => {
    try {
      const buffer = await workbookBuffer();
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="submissions-${stamp}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error('[excel]', err);
      res.sendStatus(500);
    }
  });

  // ---------------------------------------------------------------- ops
  // Liveness: answers 200 as long as the process is up, and touches nothing
  // external. A health check that queries the database gets the container
  // killed whenever the database hiccups or its credentials are missing.
  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      whatsapp: assertWhatsAppConfig().length === 0,
      storage: describeBackend(),
      baseUrl: config.baseUrl,
    });
  });

  // Readiness: actually exercises the store, for when you want to know whether
  // the backend is reachable. Never point a platform health check at this.
  app.get('/readyz', async (_req, res) => {
    try {
      const all = await listPresentations(1000);
      res.json({ ok: true, storage: describeBackend(), presentations: all.length });
    } catch (err) {
      res.status(503).json({ ok: false, storage: describeBackend(), error: err.message });
    }
  });

  app.get('/', async (_req, res) => {
    const recent = await listPresentations(10);
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>${config.brand.name} bot</title>
      <style>body{font-family:system-ui,sans-serif;background:#0d0f13;color:#f2f4f8;margin:0;padding:40px;line-height:1.6}
      a{color:#c9a227}code{background:#1c2130;padding:2px 6px;border-radius:6px}
      ul{padding-inline-start:20px}</style></head><body>
      <h1>${config.brand.name} — WhatsApp presentation bot</h1>
      ${config.simulator ? '<p>👉 <a href="/sim">Open the test chat</a> — try the whole flow without WhatsApp.</p>' : ''}
      <p>📊 <a href="/export.xlsx">Download the Excel sheet</a> — every submission with its phone number, text and images.</p>
      <p>Webhook endpoint: <code>${config.baseUrl}/webhook</code></p>
      <p>Recent submissions: <strong>${recent.length}</strong></p>
      ${recent.length ? `<h2>Recent</h2><ul>${recent
        .map((p) => {
          const first = String(p.text || '').split(/\r?\n/).find((l) => l.trim()) || p.id;
          return `<li><a href="/p/${p.id}">${first.trim().slice(0, 60)}</a> — ${p.images.length} photos · ${p.views || 0} views</li>`;
        })
        .join('')}</ul>` : ''}
      </body></html>`);
  });

  return app;
}

async function processPayload(payload) {
  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];

      for (const raw of value.messages || []) {
        if (alreadyHandled(raw.id)) continue;

        const msg = readMessage(raw);
        const contact = contacts.find((c) => c.wa_id === raw.from) || contacts[0];

        markRead(raw.id);
        console.log(`[in] ${msg.from} ${msg.kind}${msg.text ? `: ${msg.text.slice(0, 60)}` : ''}`);

        try {
          await handleIncoming(msg, contact);
        } catch (err) {
          console.error('[flow] unhandled:', err);
        }
      }

      for (const status of value.statuses || []) {
        const who = status.recipient_id || '?';
        if (status.status === 'failed') {
          const err = (status.errors || [])[0] || {};
          console.warn(
            `[status] FAILED to ${who} — ${err.code} ${err.title || ''}` +
              `${err.error_data?.details ? ` (${err.error_data.details})` : ''} [${status.id}]`,
          );
        } else {
          console.log(`[status] ${status.status} to ${who} [${status.id}]`);
        }
      }
    }
  }
}

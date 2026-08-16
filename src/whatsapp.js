import { config } from './config.js';

const api = () => `${config.graphBaseUrl}/${config.graphVersion}`;

async function graph(pathname, init = {}) {
  const res = await fetch(`${api()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${init.method || 'GET'} ${pathname} -> ${res.status}: ${body}`);
  }
  return res;
}

/**
 * Recipients handled locally instead of over the Cloud API — used by the browser
 * simulator so the same flow code can run without a WhatsApp number.
 */
const virtualRecipients = new Map();

export function registerVirtualRecipient(id, handler) {
  virtualRecipients.set(id, handler);
}

export function unregisterVirtualRecipient(id) {
  virtualRecipients.delete(id);
}

async function send(payload) {
  const virtual = payload.to ? virtualRecipients.get(payload.to) : null;
  if (virtual) {
    virtual(payload);
    return { messages: [{ id: `virtual.${Date.now()}` }] };
  }

  if (!config.token || !config.phoneNumberId) {
    console.warn('[whatsapp] not configured — would have sent:', JSON.stringify(payload));
    return null;
  }
  const res = await graph(`/${config.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  return res.json();
}

export function sendText(to, body, { preview = true } = {}) {
  return send({
    to,
    type: 'text',
    text: { body: String(body).slice(0, 4096), preview_url: preview },
  });
}

/**
 * Interactive reply buttons. WhatsApp allows max 3 buttons, titles <= 20 chars.
 */
export function sendButtons(to, body, buttons, { header, footer } = {}) {
  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: header.slice(0, 60) } } : {}),
      body: { text: String(body).slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

export function markRead(messageId) {
  if (!config.token || !config.phoneNumberId) return Promise.resolve(null);
  return send({ status: 'read', message_id: messageId }).catch(() => null);
}

/**
 * Two-step media download: resolve the CDN url, then fetch the bytes with the token.
 */
export async function fetchMedia(mediaId) {
  const metaRes = await graph(`/${mediaId}`);
  const meta = await metaRes.json();
  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!binRes.ok) {
    throw new Error(`media download failed: ${binRes.status}`);
  }
  const buffer = Buffer.from(await binRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type, sha256: meta.sha256, size: meta.file_size };
}

/**
 * Normalizes a Cloud API webhook message into the bits the flow cares about.
 */
export function readMessage(message) {
  const base = { id: message.id, from: message.from, type: message.type, timestamp: message.timestamp };

  switch (message.type) {
    case 'text':
      return { ...base, kind: 'text', text: message.text?.body?.trim() || '' };

    case 'image':
      return { ...base, kind: 'image', mediaId: message.image.id, mimeType: message.image.mime_type, caption: message.image.caption || '' };

    case 'document': {
      const mime = message.document?.mime_type || '';
      // people often send floor plans as documents
      if (mime.startsWith('image/')) {
        return { ...base, kind: 'image', mediaId: message.document.id, mimeType: mime, caption: message.document.caption || '' };
      }
      return { ...base, kind: 'unsupported', reason: 'document', mimeType: mime };
    }

    case 'interactive': {
      const reply = message.interactive?.button_reply || message.interactive?.list_reply;
      return { ...base, kind: 'action', actionId: reply?.id || '', actionTitle: reply?.title || '' };
    }

    case 'button':
      return { ...base, kind: 'action', actionId: message.button?.payload || message.button?.text || '' };

    default:
      return { ...base, kind: 'unsupported', reason: message.type };
  }
}

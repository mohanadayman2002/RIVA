/**
 * Conversation state machine.
 *
 *   IDLE ──► AWAITING_IMAGES ──► AWAITING_TEXT ──► ASK_FLOORPLAN ──┬─► AWAITING_FLOORPLANS ──► DONE
 *                                                                  └─────────(No)─────────────► DONE
 *
 * Photo batches are terminated either by the "Done" button or by an idle timer,
 * because WhatsApp delivers an album as N separate messages.
 */

import { config } from './config.js';
import { t } from './messages.js';
import { sendText, sendButtons } from './whatsapp.js';
import { saveIncomingMedia } from './media.js';
import { getSession, resetSession, saveSession, savePresentation, newId } from './store.js';
import { writeWorkbook, formatPhone } from './excel.js';

const ARABIC_RE = /[؀-ۿ]/;

/** Picks the language of the bot's own replies. Nothing is read from the listing. */
const detectLang = (text) => (ARABIC_RE.test(text) ? 'ar' : 'en');

const STEP = {
  IDLE: 'IDLE',
  AWAITING_IMAGES: 'AWAITING_IMAGES',
  AWAITING_TEXT: 'AWAITING_TEXT',
  ASK_FLOORPLAN: 'ASK_FLOORPLAN',
  AWAITING_FLOORPLANS: 'AWAITING_FLOORPLANS',
  DONE: 'DONE',
};

const ACTION = {
  DONE_PHOTOS: 'done_photos',
  DONE_TEXT: 'done_text',
  PLANS_YES: 'plans_yes',
  PLANS_NO: 'plans_no',
  DONE_PLANS: 'done_plans',
  NEW_DECK: 'new_deck',
};

const RESTART_RE = /^(new|restart|reset|start over|start|\/new|جديد|عرض جديد|ابدأ|إعادة|من الأول)$/i;

// Text is never inspected for content. The only strings with meaning are the
// answers to the floor-plan question, and only at that step.
const YES_RE = /^(y|yes|yep|sure|ok|نعم|أيوة|ايوه|اه|آه|تمام)$/i;
const NO_RE = /^(n|no|nope|skip|لا|لأ|مش دلوقتي|تخطي)$/i;

// per-user serialization + photo-batch debounce (in-memory, rebuilt on restart)
const queues = new Map();
const timers = new Map();

function enqueue(waId, job) {
  const prev = queues.get(waId) || Promise.resolve();
  const next = prev.then(job, job).catch((err) => console.error('[flow] job failed:', err));
  queues.set(waId, next);
  next.finally(() => {
    if (queues.get(waId) === next) queues.delete(waId);
  });
  return next;
}

function clearBatchTimer(waId) {
  const timer = timers.get(waId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(waId);
  }
}

function scheduleBatchTimer(waId, ms = config.batchIdleMs) {
  clearBatchTimer(waId);
  const timer = setTimeout(() => {
    timers.delete(waId);
    enqueue(waId, () => onBatchIdle(waId));
  }, ms);
  timer.unref?.();
  timers.set(waId, timer);
}

async function onBatchIdle(waId) {
  const session = await getSession(waId);
  if (!session) return;

  if (session.step === STEP.AWAITING_TEXT && session.text.trim()) {
    await promptForFloorplan(session);
  } else if (session.step === STEP.AWAITING_FLOORPLANS && session.floorplans.length > 0) {
    await generate(session);
  }
}

// ---------------------------------------------------------------- prompts

async function promptForFloorplan(session) {
  session.step = STEP.ASK_FLOORPLAN;
  await saveSession(session);
  await sendButtons(session.id, t(session.lang, 'askFloorplan'), [
    { id: ACTION.PLANS_YES, title: t(session.lang, 'buttons.yes') },
    { id: ACTION.PLANS_NO, title: t(session.lang, 'buttons.no') },
  ]);
}

async function startCollecting(session) {
  session.runId = newId(6);
  session.step = STEP.AWAITING_IMAGES;
  session.images = [];
  session.floorplans = [];
  session.text = '';
  await saveSession(session);
  await sendText(session.id, t(session.lang, 'start'), { preview: false });
}

// ---------------------------------------------------------------- generation

async function generate(session) {
  clearBatchTimer(session.id);

  const presentation = await savePresentation({
    id: newId(8),
    createdAt: new Date().toISOString(),
    // everything the agent sent, kept together on one record
    waId: session.id,
    phone: formatPhone(session.id),
    profileName: session.profileName || '',
    runId: session.runId,
    text: session.text || '',
    images: session.images.map((m) => m.rel),
    floorplans: session.floorplans.map((m) => m.rel),
    brand: { ...config.brand },
    views: 0,
  });

  session.step = STEP.DONE;
  session.lastPresentationId = presentation.id;
  await saveSession(session);

  // The link, on its own. Nothing follows it.
  const url = `${config.baseUrl}/p/${presentation.id}`;
  await sendText(session.id, t(session.lang, 'ready', { url }));

  console.log(`[flow] presentation ${presentation.id} for ${session.id} ` +
    `(${presentation.images.length} photos, ${presentation.floorplans.length} plans)`);

  // Keep the spreadsheet in step with the store. A failure here must never cost
  // the agent their link, so it is logged and swallowed.
  writeWorkbook().catch((err) => console.error('[excel] export failed:', err.message));

  return presentation;
}

// ---------------------------------------------------------------- media

async function collectImage(session, msg, bucket) {
  const list = session[bucket];

  try {
    const media = await saveIncomingMedia({
      runId: session.runId,
      mediaId: msg.mediaId,
      mimeType: msg.mimeType,
    });
    if (list.some((m) => m.id === media.id)) return false; // duplicate delivery
    list.push(media);
    await saveSession(session);
    return true;
  } catch (err) {
    console.error('[flow] media download failed:', err.message);
    await sendText(session.id, t(session.lang, 'mediaError'), { preview: false });
    return false;
  }
}

// ---------------------------------------------------------------- entry point

export function handleIncoming(msg, contact) {
  return enqueue(msg.from, () => route(msg, contact));
}

async function route(msg, contact) {
  const waId = msg.from;
  let session = await getSession(waId);

  if (!session) {
    session = await resetSession(waId, contact?.profile?.name);
    session.lang = 'en';
  }
  // Only write when something actually changed — with a networked store, a save
  // on every inbound message is a round-trip the agent waits for.
  let dirty = false;

  if (contact?.profile?.name && session.profileName !== contact.profile.name) {
    session.profileName = contact.profile.name;
    dirty = true;
  }

  // Language follows the agent: first Arabic text switches the bot to Arabic.
  const lang = msg.kind === 'text' && msg.text ? detectLang(msg.text) : session.lang || 'en';
  if (lang !== session.lang) {
    session.lang = lang;
    dirty = true;
  }

  if (dirty) await saveSession(session);

  // Global commands
  if (msg.kind === 'action' && msg.actionId === ACTION.NEW_DECK) {
    return startCollecting(session);
  }
  if (msg.kind === 'text' && RESTART_RE.test(msg.text)) {
    return startCollecting(session);
  }

  switch (session.step) {
    case STEP.IDLE:
    case STEP.DONE:
      await startCollecting(session);
      if (msg.kind === 'image') return handleImage(session, msg);
      return undefined;

    case STEP.AWAITING_IMAGES:
      return handleAwaitingImages(session, msg);

    case STEP.AWAITING_TEXT:
      return handleAwaitingText(session, msg);

    case STEP.ASK_FLOORPLAN:
      return handleAskFloorplan(session, msg);

    case STEP.AWAITING_FLOORPLANS:
      return handleAwaitingFloorplans(session, msg);

    default:
      return startCollecting(session);
  }
}
async function handleImage(session, msg) {
  const first = session.images.length === 0;
  const added = await collectImage(session, msg, 'images');
  if (!added) return;

  // The only prompt of this step, asked once.
  if (first) {
    await sendButtons(session.id, t(session.lang, 'donePhotos'), [
      { id: ACTION.DONE_PHOTOS, title: t(session.lang, 'buttons.done') },
    ]);
  }
}

async function handleAwaitingImages(session, msg) {
  if (msg.kind === 'image') {
    return handleImage(session, msg);
  }

  if (msg.kind === 'action' && msg.actionId === ACTION.DONE_PHOTOS) {
    // Move on silently — the next question comes when their text arrives.
    session.step = STEP.AWAITING_TEXT;
    return saveSession(session);
  }

  if (msg.kind === 'text' && msg.text) {
    session.step = STEP.AWAITING_TEXT;
    return collectText(session, msg.text);
  }

  return undefined;
}

/**
 * Text is gathered exactly like photos: every message is appended in order and
 * kept verbatim. Nothing is parsed, judged or discarded.
 */
async function collectText(session, text) {
  const first = !session.text.trim();
  session.text = first ? text : `${session.text}\n${text}`;
  await saveSession(session);

  scheduleBatchTimer(session.id, config.textIdleMs);

  if (first) {
    await sendButtons(session.id, t(session.lang, 'doneText'), [
      { id: ACTION.DONE_TEXT, title: t(session.lang, 'buttons.done') },
    ]);
  }
}

async function handleAwaitingText(session, msg) {
  if (msg.kind === 'image') {
    // More photos after the batch closed — keep them.
    return handleImage(session, msg);
  }

  if (msg.kind === 'action') {
    if (msg.actionId === ACTION.DONE_TEXT) {
      clearBatchTimer(session.id);
      return promptForFloorplan(session);
    }
    return undefined; // stale tap from an earlier step
  }

  if (msg.kind === 'text' && msg.text) {
    return collectText(session, msg.text);
  }

  return undefined;
}

async function handleAskFloorplan(session, msg) {
  const wantsPlans =
    (msg.kind === 'action' && msg.actionId === ACTION.PLANS_YES) ||
    (msg.kind === 'text' && YES_RE.test(msg.text));

  const skipsPlans =
    (msg.kind === 'action' && msg.actionId === ACTION.PLANS_NO) ||
    (msg.kind === 'text' && NO_RE.test(msg.text));

  if (skipsPlans) return generate(session);

  if (wantsPlans) {
    // Silence until a plan arrives; the Done question comes with it.
    session.step = STEP.AWAITING_FLOORPLANS;
    return saveSession(session);
  }

  if (msg.kind === 'image') {
    // They started sending plans without answering.
    session.step = STEP.AWAITING_FLOORPLANS;
    await saveSession(session);
    return handleAwaitingFloorplans(session, msg);
  }

  if (msg.kind === 'action') return undefined; // stale tap

  if (msg.kind === 'text' && msg.text) {
    // Still typing details — keep them and wait for a yes/no.
    session.text = `${session.text}\n${msg.text}`.trim();
    return saveSession(session);
  }

  return undefined;
}

async function handleAwaitingFloorplans(session, msg) {
  if (msg.kind === 'image') {
    const first = session.floorplans.length === 0;
    const added = await collectImage(session, msg, 'floorplans');
    if (!added) return;

    scheduleBatchTimer(session.id);
    if (first) {
      await sendButtons(session.id, t(session.lang, 'donePlans'), [
        { id: ACTION.DONE_PLANS, title: t(session.lang, 'buttons.done') },
      ]);
    }
    return;
  }

  if (msg.kind === 'action' && msg.actionId === ACTION.DONE_PLANS) {
    return generate(session);
  }

  if (msg.kind === 'text' && NO_RE.test(msg.text)) {
    return generate(session);
  }

  return undefined;
}

export { STEP, ACTION };

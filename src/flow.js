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
  PLANS_YES: 'plans_yes',
  PLANS_NO: 'plans_no',
  DONE_PLANS: 'done_plans',
  NEW_DECK: 'new_deck',
};

const RESTART_RE = /^(new|restart|reset|start over|start|\/new|جديد|عرض جديد|ابدأ|إعادة|من الأول)$/i;
const DONE_RE = /^(done|finish|finished|ok|okay|next|تم|خلاص|انتهيت|كفاية)$/i;
const YES_RE = /^(y|yes|yep|sure|ok|نعم|أيوة|ايوه|اه|آه|تمام)$/i;
const NO_RE = /^(n|no|nope|skip|لا|لأ|مش دلوقتي|تخطي)$/i;
// \b is ASCII-only in JavaScript, so an Arabic alternative followed by \b can
// never match. A unicode-aware lookahead works for both scripts.
const GREETING_RE =
  /^(hi+|hello|hey|yo|good (morning|evening|afternoon)|thanks|thank you|ty|ok|okay|salam|السلام عليكم|وعليكم السلام|اهلا|أهلا|مرحبا|هاي|صباح الخير|مساء الخير|شكرا|شكراً|تمام)(?![\p{L}\p{N}])[\s!.,؟?]*$/iu;

/** A bare "hi" / "شكرا" and nothing else. */
function isGreeting(text) {
  const value = String(text).trim();
  return !value || GREETING_RE.test(value);
}

/**
 * Used only while photos are still arriving, where a stray "ok" must not be
 * mistaken for the listing. Details are long, multi-line, or contain a number.
 *
 * Once the agent has actually been asked for the details, this test is wrong —
 * "hello palm hills hello" is a real listing and was being bounced by it.
 */
function looksLikeDetails(text) {
  const value = String(text).trim();
  if (isGreeting(value)) return false;
  return value.length >= 25 || value.includes('\n') || /\d/.test(value);
}

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

function scheduleBatchTimer(waId) {
  clearBatchTimer(waId);
  const timer = setTimeout(() => {
    timers.delete(waId);
    enqueue(waId, () => onBatchIdle(waId));
  }, config.batchIdleMs);
  timer.unref?.();
  timers.set(waId, timer);
}

async function onBatchIdle(waId) {
  const session = await getSession(waId);
  if (!session) return;

  if (session.step === STEP.AWAITING_IMAGES && session.images.length > 0) {
    await promptForText(session);
  } else if (session.step === STEP.AWAITING_FLOORPLANS && session.floorplans.length > 0) {
    await generate(session);
  }
}

// ---------------------------------------------------------------- prompts

async function promptForText(session) {
  session.step = STEP.AWAITING_TEXT;
  await saveSession(session);
  await sendText(session.id, t(session.lang, 'askText', { n: session.images.length }), { preview: false });
}

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
  await sendText(session.id, t(session.lang, 'greeting', { brand: config.brand.name }), { preview: false });
}

// ---------------------------------------------------------------- generation

async function generate(session) {
  clearBatchTimer(session.id);
  await sendText(session.id, t(session.lang, 'generating'), { preview: false });

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

  const url = `${config.baseUrl}/p/${presentation.id}`;
  await sendText(session.id, t(session.lang, 'ready', { url }));
  await sendButtons(session.id, t(session.lang, 'startNew'), [
    { id: ACTION.NEW_DECK, title: t(session.lang, 'buttons.newDeck') },
  ]);

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
  if (list.length >= config.maxImages) {
    await sendText(session.id, t(session.lang, 'limitReached', { n: config.maxImages }), { preview: false });
    return false;
  }

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

  scheduleBatchTimer(session.id);

  if (first) {
    await sendButtons(session.id, t(session.lang, 'firstPhoto'), [
      { id: ACTION.DONE_PHOTOS, title: t(session.lang, 'buttons.donePhotos') },
    ]);
  }
}

async function handleAwaitingImages(session, msg) {
  if (msg.kind === 'image') {
    return handleImage(session, msg);
  }

  if (msg.kind === 'action' && msg.actionId === ACTION.DONE_PHOTOS) {
    clearBatchTimer(session.id);
    if (!session.images.length) {
      return sendText(session.id, t(session.lang, 'needPhotos'), { preview: false });
    }
    return promptForText(session);
  }

  if (msg.kind === 'text') {
    if (!session.images.length) {
      return sendText(session.id, t(session.lang, 'needPhotos'), { preview: false });
    }
    if (DONE_RE.test(msg.text)) {
      clearBatchTimer(session.id);
      return promptForText(session);
    }
    if (!looksLikeDetails(msg.text)) {
      // Small talk mid-upload — don't mistake it for the listing.
      return sendButtons(session.id, t(session.lang, 'keepSending'), [
        { id: ACTION.DONE_PHOTOS, title: t(session.lang, 'buttons.donePhotos') },
      ]);
    }
    // Agent skipped ahead and sent the details already — take them.
    clearBatchTimer(session.id);
    session.text = msg.text;
    await saveSession(session);
    return promptForFloorplan(session);
  }

  return sendText(session.id, t(session.lang, 'unsupported'), { preview: false });
}

async function handleAwaitingText(session, msg) {
  if (msg.kind === 'image') {
    // More photos after the batch closed — keep them.
    return handleImage(session, { ...msg });
  }

  // A second tap on the "Done" button from the previous step. The prompt has
  // already been sent, so repeating it just spams the chat.
  if (msg.kind === 'action') return undefined;

  // The agent was asked for the details, so take whatever they send — the only
  // thing turned away is a bare greeting.
  if (msg.kind === 'text' && msg.text && !isGreeting(msg.text)) {
    session.text = msg.text;
    await saveSession(session);
    return promptForFloorplan(session);
  }

  return sendText(session.id, t(session.lang, 'askText', { n: session.images.length }), { preview: false });
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
    session.step = STEP.AWAITING_FLOORPLANS;
    await saveSession(session);
    return sendButtons(session.id, t(session.lang, 'floorplanPrompt'), [
      { id: ACTION.DONE_PLANS, title: t(session.lang, 'buttons.donePlans') },
    ]);
  }

  if (msg.kind === 'image') {
    // They just started sending plans without answering.
    session.step = STEP.AWAITING_FLOORPLANS;
    await saveSession(session);
    return handleAwaitingFloorplans(session, msg);
  }

  // A stale tap on an earlier step's button — ignore instead of re-asking.
  if (msg.kind === 'action') return undefined;

  if (msg.kind === 'text' && msg.text && looksLikeDetails(msg.text)) {
    // Extra detail sent after the fact — append it, then re-ask.
    session.text = `${session.text}\n${msg.text}`.trim();
    await saveSession(session);
  }

  return promptForFloorplan(session);
}

async function handleAwaitingFloorplans(session, msg) {
  if (msg.kind === 'image') {
    const added = await collectImage(session, msg, 'floorplans');
    if (added) scheduleBatchTimer(session.id);
    return;
  }

  if (msg.kind === 'action' && msg.actionId === ACTION.DONE_PLANS) {
    return generate(session);
  }

  if (msg.kind === 'text' && (DONE_RE.test(msg.text) || NO_RE.test(msg.text))) {
    return generate(session);
  }

  return sendText(session.id, t(session.lang, 'floorplanPrompt'), { preview: false });
}

export { STEP, ACTION };

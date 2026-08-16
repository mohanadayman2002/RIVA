/**
 * Verifies the WhatsApp Cloud API credentials in .env without sending anything.
 *
 *   npm run check:whatsapp
 *
 * Confirms the token can read the configured phone number, reports the display
 * number and its quality rating, and checks the webhook subscription — the
 * single most common reason a correctly-built bot stays silent.
 *
 * Never prints the token.
 */

import 'dotenv/config';
import { config, assertWhatsAppConfig } from '../src/config.js';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const note = (m) => console.log(`    ${m}`);

const api = `${config.graphBaseUrl}/${config.graphVersion}`;
const auth = { Authorization: `Bearer ${config.token}` };

async function graph(path) {
  const res = await fetch(`${api}${path}`, { headers: auth });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

console.log('\n  WhatsApp Cloud API check\n');

const missing = assertWhatsAppConfig();
if (missing.length) {
  bad(`missing in .env: ${missing.join(', ')}`);
  console.log('\n  Fill those in, then run this again.\n');
  process.exit(1);
}
ok(`token and phone number id present (graph ${config.graphVersion})`);

// ---------------------------------------------------------------- the number
const number = await graph(
  `/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type`,
);

if (number.status !== 200) {
  bad(`cannot read phone number ${config.phoneNumberId} — ${number.status}`);
  note(number.body?.error?.message || JSON.stringify(number.body).slice(0, 200));
  if (number.body?.error?.code === 190) note('token is expired or invalid — generate a new one');
  process.exit(1);
}

ok(`number: ${number.body.display_phone_number}  (${number.body.verified_name || 'unnamed'})`);
if (number.body.quality_rating) note(`quality rating: ${number.body.quality_rating}`);

// ---------------------------------------------------------------- app secret
if (config.appSecret) {
  ok('app secret set — webhook signatures will be verified');
} else {
  bad('WHATSAPP_APP_SECRET is empty — webhook signatures are NOT verified');
  note('anyone who finds your webhook url could post fake messages to it');
}

// ---------------------------------------------------------------- public url
if (/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
  bad(`BASE_URL is ${config.baseUrl} — Meta cannot reach that`);
  note('start a tunnel and put its https url in BASE_URL');
} else if (!config.baseUrl.startsWith('https://')) {
  bad(`BASE_URL must be https — currently ${config.baseUrl}`);
} else {
  ok(`BASE_URL is public: ${config.baseUrl}`);

  const verify = await fetch(
    `${config.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.verifyToken)}&hub.challenge=ping`,
  ).catch((err) => ({ status: 0, error: err.message }));

  if (verify.status === 200 && (await verify.text()) === 'ping') {
    ok('webhook verification endpoint answers correctly from the outside');
  } else {
    bad(`webhook verification failed from the outside (status ${verify.status || verify.error})`);
    note('is the server running, and is the tunnel pointing at it?');
  }
}

// ---------------------------------------------------------------- token shape
const debug = await graph(`/debug_token?input_token=${config.token}`);
if (debug.status === 200 && debug.body?.data) {
  const { type, expires_at: expiresAt } = debug.body.data;
  if (expiresAt === 0) ok(`token: ${type || 'user'}, never expires`);
  else {
    const when = new Date(expiresAt * 1000);
    const hours = Math.round((when - Date.now()) / 3.6e6);
    if (hours <= 0) bad(`token expired on ${when.toISOString()}`);
    else bad(`token expires in ~${hours}h (${when.toISOString()}) — swap in a System User token`);
  }
}

// ---------------------------------------------------------------- subscription
// subscribed_apps hangs off the WhatsApp Business Account, not the phone number.
// The WABA id is not on the phone node, so it comes from env or is skipped.
if (config.wabaId) {
  const subs = await graph(`/${config.wabaId}/subscribed_apps`);
  const apps = subs.body?.data || [];
  if (subs.status === 200 && apps.length) {
    ok(`app subscribed to the business account: ${apps.map((a) => a.whatsapp_business_api_data?.name || 'app').join(', ')}`);
  } else {
    bad('no app is subscribed to this WhatsApp Business Account');
    note('WhatsApp → Configuration → Webhook → Manage → tick "messages"');
  }
} else {
  note('set WHATSAPP_BUSINESS_ACCOUNT_ID in .env to also verify the webhook subscription');
  note('(the real proof is simply messaging the number — the log will show it arrive)');
}

console.log(`\n  Webhook to paste into Meta:\n    ${config.baseUrl}/webhook`);
console.log(`  Verify token:\n    ${config.verifyToken}\n`);

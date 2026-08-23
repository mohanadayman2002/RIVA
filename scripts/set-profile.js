/**
 * Updates the bot's WhatsApp business profile — the picture, and the text
 * fields shown on the business card in WhatsApp.
 *
 *   npm run profile                          show what is set now
 *   npm run profile -- --picture logo.png    set the profile picture
 *   npm run profile -- --about "One line"    set the "about" line
 *   npm run profile -- --description "..."   set the description
 *   npm run profile -- --website https://…   set the website (repeatable)
 *
 * The display NAME cannot be set here. It lives in WhatsApp Manager and goes
 * through Meta review — see the note printed at the end.
 *
 * Setting a picture is a three-step dance: open a resumable upload session,
 * post the bytes to it, then attach the returned handle to the profile.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { config, assertWhatsAppConfig } from '../src/config.js';

const api = `${config.graphBaseUrl}/${config.graphVersion}`;
const auth = { Authorization: `Bearer ${config.token}` };

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function parseArgs(argv) {
  const out = { websites: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--picture') (out.picture = value), i++;
    else if (flag === '--about') (out.about = value), i++;
    else if (flag === '--description') (out.description = value), i++;
    else if (flag === '--email') (out.email = value), i++;
    else if (flag === '--address') (out.address = value), i++;
    else if (flag === '--website') (out.websites.push(value), i++);
  }
  return out;
}

async function showProfile() {
  const res = await fetch(
    `${api}/${config.phoneNumberId}/whatsapp_business_profile` +
      '?fields=about,address,description,email,profile_picture_url,websites,vertical',
    { headers: auth },
  );
  const body = await res.json();
  const profile = (body.data || [{}])[0];

  console.log('\n  Current profile');
  for (const key of ['about', 'description', 'address', 'email', 'vertical']) {
    console.log(`    ${key.padEnd(12)} ${profile[key] ?? '—'}`);
  }
  console.log(`    ${'websites'.padEnd(12)} ${(profile.websites || []).join(', ') || '—'}`);
  console.log(`    ${'picture'.padEnd(12)} ${profile.profile_picture_url ? 'set' : 'none'}`);
  return profile;
}

/** Resumable upload: returns the handle the profile endpoint wants. */
async function uploadPicture(file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) throw new Error(`use a .jpg or .png file (got "${ext || 'no extension'}")`);

  const bytes = await fsp.readFile(file);
  if (bytes.length > 5 * 1024 * 1024) throw new Error('picture must be under 5 MB');

  // The upload API is an app-level endpoint, so it needs the app token.
  const debug = await (await fetch(`${api}/debug_token?input_token=${config.token}`, { headers: auth })).json();
  const appId = debug?.data?.app_id;
  if (!appId) throw new Error('could not resolve the app id from the token');
  if (!config.appSecret) throw new Error('WHATSAPP_APP_SECRET is required to upload a picture');
  const appToken = `${appId}|${config.appSecret}`;

  const start = await (
    await fetch(
      `${api}/${appId}/uploads?file_name=${encodeURIComponent(path.basename(file))}` +
        `&file_length=${bytes.length}&file_type=${encodeURIComponent(type)}&access_token=${encodeURIComponent(appToken)}`,
      { method: 'POST' },
    )
  ).json();
  if (!start.id) throw new Error(`could not open an upload session: ${JSON.stringify(start).slice(0, 200)}`);

  const finish = await (
    await fetch(`${api}/${start.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${appToken}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
      body: bytes,
    })
  ).json();
  if (!finish.h) throw new Error(`upload failed: ${JSON.stringify(finish).slice(0, 200)}`);

  console.log(`    uploaded ${(bytes.length / 1024).toFixed(0)} KB (${type})`);
  return finish.h;
}

async function main() {
  const missing = assertWhatsAppConfig();
  if (missing.length) {
    console.error(`\n  Missing in .env: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  await showProfile();

  const patch = { messaging_product: 'whatsapp' };
  if (args.about) patch.about = args.about;
  if (args.description) patch.description = args.description;
  if (args.email) patch.email = args.email;
  if (args.address) patch.address = args.address;
  if (args.websites.length) patch.websites = args.websites;

  if (args.picture) {
    console.log(`\n  Uploading ${args.picture}`);
    patch.profile_picture_handle = await uploadPicture(args.picture);
  }

  if (Object.keys(patch).length === 1) {
    console.log('\n  Nothing to change. Pass --picture / --about / --description to update.');
  } else {
    const res = await fetch(`${api}/${config.phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
      console.error(`\n  Update failed: ${body.error?.message || JSON.stringify(body)}\n`);
      process.exit(1);
    }
    console.log('\n  Updated.');
    await showProfile();
  }

  // The display name is not part of this endpoint.
  const num = await (
    await fetch(`${api}/${config.phoneNumberId}?fields=verified_name,name_status`, { headers: auth })
  ).json();
  console.log(`\n  Display name: "${num.verified_name}"  (status: ${num.name_status || 'unknown'})`);
  console.log('  To change it: business.facebook.com → WhatsApp Manager → Phone numbers');
  console.log('  → the number → Settings → Profile → Business name. Meta reviews it.\n');
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});

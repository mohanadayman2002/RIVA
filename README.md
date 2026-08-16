# RIVA — WhatsApp property presentation bot

An agent sends photos and a text description to a WhatsApp number; the bot replies
with a link to a page holding both.

```
Agent opens chat
  Bot   →  "Send the photos"
  Agent →  uploads images
  Bot   →  "Now send the details"
  Agent →  sends price / size / location / …
  Bot   →  "Upload a floor plan?"  [Yes] [No]
  Agent →  uploads plans, or taps No
  Bot   →  https://your-domain/p/AbC123   ← the presentation
```

The page shows the agent's message **exactly as they typed it** — line breaks and
spacing intact, nothing parsed, reordered or rewritten — with the photos listed
underneath in the order they were sent, floor plans last. Arabic text switches the
page to RTL.

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in the values below
npm start
```

## Test it without WhatsApp

```bash
npm start                 # then open http://localhost:3000/sim
```

`/sim` is a chat page that talks to the **real** state machine and renderer — the
only things swapped out are the two edges that need Meta:
outgoing messages go to the browser instead of the Cloud API, and attached
photos are stashed instead of downloaded from Graph. Anything that works there
works on WhatsApp.

Attach photos with 📎, tap the bot's reply buttons, paste one of the sample
listings from the sidebar (English or Arabic), and open the link it sends back.
**New chat** starts a fresh conversation.

Turn it off in production with `SIMULATOR=off`.

Or generate finished presentations directly, with no chat at all:

```bash
npm run demo              # creates two sample presentations, prints their links
npm start
```

## Setup

### 1. Meta / WhatsApp Cloud API

1. Create an app at [developers.facebook.com](https://developers.facebook.com) →
   **Business** type → add the **WhatsApp** product.
2. Under **WhatsApp → API Setup**, copy the **Phone number ID** and a token into
   `.env` (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`). The test token expires in
   24h — create a **System User** token in Business Settings for anything permanent.
3. Copy the **App Secret** from **App Settings → Basic** into `WHATSAPP_APP_SECRET`
   so webhook signatures are verified.

### 2. Expose the server

In development:

```bash
npx ngrok http 3000
```

Put the HTTPS URL into `BASE_URL` in `.env` and restart. That URL is what gets
embedded into every presentation link, so it must be publicly reachable.

### 3. Point the webhook at it

**WhatsApp → Configuration → Webhook → Edit**

| Field | Value |
|---|---|
| Callback URL | `https://<your-domain>/webhook` |
| Verify token | the same string as `WHATSAPP_VERIFY_TOKEN` |

Then **Manage → subscribe to the `messages` field**. Missing that subscription is
the usual reason a correctly-configured bot stays silent.

### 4. Message the number

Send anything to the business number and the flow starts.

> Businesses can only message a user within 24h of that user's last message,
> which this flow always satisfies — the agent always writes first.

---

## Conversation details worth knowing

- **Photo batches.** WhatsApp delivers an album as N separate messages, so the bot
  waits for a *Done* tap or `BATCH_IDLE_MS` (default 8s) of silence before moving on.
- **Skipping ahead.** An agent who sends photos and then immediately types the
  details skips the "Step 2" prompt automatically.
- **`new`** (or `جديد`, or the *New presentation* button) restarts at any point.
- **Floor plans** sent as image-documents are accepted too.
- Old links keep working after a restart — each run writes to its own folder.

## Project layout

```
src/
  index.js      entry point, graceful shutdown
  server.js     express app: webhook, /p/:id, /media, /healthz
  flow.js       conversation state machine (per-user queue + batch timers)
  whatsapp.js   Cloud API client: text, buttons, media download
  media.js      media persistence + path-traversal guard
  render.js     presentation HTML — the text as sent, images below
  messages.js   bot copy, EN + AR
  sim.js        /sim browser test chat (SSE), disable with SIMULATOR=off
  store.js      storage facade — Supabase when configured, JSON file otherwise
  supabase.js   Postgres + Storage backend
  excel.js      spreadsheet export (/export.xlsx)
scripts/
  demo.js       generate sample presentations without WhatsApp
supabase/
  schema.sql    tables, storage bucket and RLS — run once in the SQL editor
data/            local fallback: uploads, db.json, presentations.xlsx
```

## Where the data goes

Every submission is stored with the sender's phone number, so the text, the
photos and the number who sent them stay linked.

### Supabase (when configured)

Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, run
[supabase/schema.sql](supabase/schema.sql) once in the SQL editor, and the bot
uses Postgres and Storage instead of local files:

| Table | Holds |
|---|---|
| `submissions` | one row per presentation — id, phone, WhatsApp name, the message verbatim, views |
| `submission_images` | one row per file — `submission_id` foreign key, photo/floorplan, position, storage path |
| `sessions` | in-progress conversations, so a restart mid-chat keeps the photos already sent |

Image bytes go to the `listings` storage bucket under a random run id. The
`/media/...` route redirects to the bucket's public URL, so links keep one
shape whichever backend is live.

RLS is on for all three tables with no policies: nothing reads them with the
anon key. The bot uses the service_role key, which bypasses RLS and must stay
server-side.

### Local files (when Supabase is blank)

`data/db.json` plus `data/uploads/<run-id>/`. Same behaviour, no network — this
is what `/sim` and `npm run demo` fall back to.

### The spreadsheet

`data/presentations.xlsx` is rewritten after every submission, two sheets
joined on *Presentation ID*:

| Sheet | One row per | Columns |
|---|---|---|
| Submissions | presentation | ID, date, time, phone number, WhatsApp name, full text, photo count, floor-plan count, link, views |
| Images | uploaded file | presentation ID, phone number, date, photo/floor plan, order, filename, direct link |

Download the current sheet any time from **`GET /export.xlsx`**, or the link on
the server's home page. Links in the sheet resolve against `BASE_URL`, so set
that to your public URL if you want them clickable from another machine.

## Operations

- `GET /healthz` — config sanity, which storage backend is live, submission count.
- `GET /` — recent submissions and the spreadsheet link, handy while testing.
- **Multiple instances** are fine on Supabase (sessions live in Postgres). On the
  local JSON fallback, run only one — it rewrites the whole file on every change.
- Presentation links are unguessable but public. Anyone with the link can view,
  and so can anyone with a storage URL — the bucket is public by design.
- **`/export.xlsx` is unauthenticated.** It hands out every phone number you have
  collected. Put auth in front of it before this server is reachable publicly.

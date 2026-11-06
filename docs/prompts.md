# Prompts to make it yours

Paste these into an AI coding assistant opened **in the project folder** (Claude Code, Cursor, Copilot Chat, Codex…). Each one starts by telling the assistant where to look, so it follows the decisions already made instead of reinventing them. Change the parts in `<angle brackets>`.

Tip: ask for one change at a time, try it with `npm run dev`, and only then move on.

---

## 1. Put it online on my Cloudflare account

```
This is nectr, a private music sharing app for Cloudflare Workers (D1, R2, Access).
Read README.md, docs/setup.md and wrangler.jsonc. Walk me through deploying my own
copy on the Cloudflare free plans, one step at a time, waiting for me after each step.
Replace every value in wrangler.jsonc that belongs to the original owner (email,
account ID, D1 database ID, Access team domain and AUD, bucket name) with mine.
Never ask me to paste secrets into the chat: when a secret is needed, give me the
`wrangler secret put` command to run myself. Speak to me in <my language>.
```

## 2. Translate the interface

```
The interface of this app is in European Portuguese (src/web, plus the share pages
and notification texts in src/worker). Translate it into <English>. Keep the same
tone: short, plain, friendly. Put the strings where they already are (no i18n
library unless you can justify it in one line). Also translate guest-facing
messages from the Worker (errors, notifications, the neutral "link unavailable"
page) and the guest-name checks in src/shared/guest-name.ts if they are
language-specific. Run `npm run check` and `npm test` at the end.
```

## 3. Run it on my own server instead of Cloudflare

```
This app runs on Cloudflare Workers with D1 (SQLite), R2 (object storage) and
Cloudflare Access (owner login). I want to host it on <my own Linux server / a NAS /
a Raspberry Pi / Fly.io / Render> without Cloudflare. Read README.md, docs/plano.md
and src/worker first. Plan the smallest adapter layer, keeping all routes and the
whole interface unchanged:
- D1 → SQLite (better-sqlite3 or node:sqlite), same migrations;
- R2 → a local folder (or any S3-compatible bucket), including Range requests for
  streaming and a replacement for the presigned upload URL;
- Access → a simple owner login (email + one-time code, or a password with a
  secure session cookie);
- the daily cron and rate limiting → in-process equivalents.
Hono runs on Node, so the Worker code should mostly stay. Show me the plan before
writing code, and keep the original Cloudflare path working too if it is cheap.
```

## 4. A video review app

```
Use this project as the base for a private video review app. Read README.md and
docs/plano.md first; keep the architecture (Worker + D1 + R2 + Access, guest links,
versions, timestamped and range comments, voice notes, notifications, re-shares).
Changes:
- uploads accept MP4/MOV/WebM (H.264/H.265/VP9/AV1); validate the container header
  like src/shared/audio does for WAV/MP3;
- replace the waveform with a <video> player plus a timeline with comment markers;
  show timecodes as HH:MM:SS:FF at the file's frame rate, and step frame by frame;
- comments can carry a drawing over the frame (optional, later phase);
- drop loudness and lyrics, or keep loudness for the audio track only.
Watch the R2 free plan (10 GB): suggest a size limit and proxy files if needed.
Propose phases and wait for my OK before each one.
```

## 5. A photography app

```
Use this project as the base for a private photo delivery and proofing app. Read
README.md and docs/plano.md first; keep artists→projects→folders as clients→shoots→
galleries, guest links (password, expiry, download on/off), comments, notifications
and re-shares. Changes:
- uploads accept JPEG/PNG/WebP/HEIC/TIFF; make web-sized previews in the browser
  (like the cover cropper does) and keep the original for download;
- a grid view and a full-screen viewer with swipe on phones;
- guests mark favourites (a shortlist the owner can export) and comment on a point
  of the image instead of a timestamp;
- "versions" become retouch rounds of the same photo, with a before/after slider.
Stay inside the free plans. Propose phases and wait for my OK before each one.
```

## 6. Other ideas, one line each

- "Add a second owner (my partner) with the same rights, still behind Cloudflare Access."
- "Let guests rate each version from 1 to 5 and show the average to the owner."
- "Add an English/Portuguese switch for guests, remembered per device."
- "Export all comments of a track as a text file with timestamps, for my mixing engineer."
- "Add a custom domain: update wrangler.jsonc, Access, R2 CORS and redirect the old workers.dev links."

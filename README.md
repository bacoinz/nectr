# nectr

A private place to share unreleased music and get feedback on it: your own "cloud" of tracks, versions and listening links, with comments pinned to the exact second. It runs on **your** account, on Cloudflare's free plans, so there is no subscription and nobody else holds your music.

> 🇵🇹 Versão em português: [README.pt-PT.md](README.pt-PT.md)
>
> The app's interface is in **European Portuguese** today. Translating it is one of the prompts in [docs/prompts.md](docs/prompts.md).

It was built for one musician (the owner) and the people they send music to (artists, labels, mixing engineers, friends). The guests never need an account.

## What it does

### Library (owner)
- **Artists → projects → folders → tracks → versions.** Projects can be an album/EP (cover, year, label, description), a work in progress, a live set, or a plain folder.
- **Drop files anywhere** to upload WAV (16/24 bit) and MP3. A whole folder from your computer becomes a project or a folder. Files go straight from the browser to storage, with a progress bar.
- **Versions**: drop a new mix on a track and it becomes the latest version. Drag one track onto another to merge them. Keep any version as its own track again, or "keep only the latest version".
- **Waveform** with zoom up to 16×, loop, ±5 s, next track, keyboard shortcuts.
- **Loudness on upload**: integrated LUFS, LRA and true peak (EBU R128 / ITU-R BS.1770). Checked against ffmpeg's `ebur128` to within 0.04, and MP3s are decoded without clipping.
- **A/B between versions** on desktop: the other versions stay loaded and follow the playhead, so a switch is instant (key **B** jumps back).
- **Lyrics**: paste or import `.lrc`, sync by tapping along, shown karaoke-style. They can be set per track or per version.
- **Organise**: 24 colours, icons, covers for projects and tracks, a built-in image cropper, drag to reorder, move, rename. A private "session name" (e.g. the Ableton Live Set name) is visible only to you.
- **Search** everything with Ctrl/⌘+K. A storage meter shows what the free plan has left. Anything you delete stays for 7 days, so you can undo it, and then it is removed for good.
- **Light and dark themes**, and an installable app (PWA) on phone and desktop.

### Sharing links (guests)
- **Share** an artist, a project, a folder or a single track.
- **Each link can have:**
  - a password;
  - an expiry date;
  - a download button;
  - lyrics;
  - comments;
  - a choice between "always the latest version", "all versions" or "only these versions".
- You can revoke a link at any time. A dead link shows a neutral page that reveals nothing.
- **Guests listen** on a page that works well on phones. They browse folders, see the cover on the lock screen, and control playback from the notification. The player moves on to the next track when one ends.
- **Comments at a timestamp or a range**, typed or as **voice notes** (up to 1 min, recorded in the browser). They appear as markers on the waveform.
  - Guests give a name once; obvious spam names are refused.
  - You reply in public or write private notes. Requests are marked open or done, along with the version that fixed them.
- **Reviews page**: every open request across the library, with replies in place.
- **Who came in**: each link lists the guests who entered, when they did, and their comments.
- **Guest re-shares** (opt-in per link): a guest can pass on one track or folder as a listen-only link that dies with the original. You see who shared what with whom.
- **Notifications** (Web Push, free):
  - you get one for new comments, voice notes and shares;
  - guests get one for your replies and for new tracks or versions on their link.

### Under the hood
- **Cloudflare Workers** (Hono) for the API and the share pages.
- **D1** (SQLite) for the data.
- **R2** for audio and images.
- **Cloudflare Access** to protect the owner's pages.
- **Svelte 5 + Vite** for the interface.
- Few dependencies:
  - Hono;
  - `jose` (Access tokens);
  - `aws4fetch` (presigned uploads);
  - `mpg123-decoder` (exact MP3 peaks);
  - self-hosted fonts.
- Web Push encryption and VAPID are written on Web Crypto, with no library.
- Audio analysis (waveform and loudness) runs **in the browser**, so the server stays inside the free CPU limits. [docs/limites.md](docs/limites.md) explains where each free quota goes.
- **Security:**
  - only the owner's paths sit behind Access;
  - link passwords use PBKDF2 and attempts are rate-limited;
  - signed cookies;
  - a strict CSP;
  - audio is never cached by the service worker;
  - private fields (file names, session names, private notes) never leave the owner API, and tests check that.
- **Tests:** Vitest with Cloudflare's Workers pool, around 110 of them, covering the API, links, permissions, the clean-up job, the loudness meter against the EBU test signals, push encryption against the RFC vectors, and lyrics parsing.

## What it costs

Nothing, if you stay within Cloudflare's free plans:

| Service | Free plan | What it means here |
|---|---|---|
| Workers | 100,000 requests/day | Far more than a musician and their clients use |
| R2 | 10 GB, no egress fees | ~115 five-minute 24-bit WAVs, or ~800 MP3s at 320 kbps |
| D1 | 5 GB | Years of comments |
| Access | 50 users | Only the owner logs in |

Turning on R2 asks for a card, but nothing is charged inside the free 10 GB. If you ever outgrow it, the Workers paid plan is 5 USD/month and R2 is ~0.015 USD per extra GB.

## Run your own

You need Node 22+, a free Cloudflare account and about 30 minutes.

```bash
git clone <this repo> my-player && cd my-player
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

That is a full local copy at `http://localhost:5173`, with local storage and database and no Cloudflare account needed. On localhost you are the owner without logging in. It is for trying it out and for development, since guests cannot reach your computer.

To put it online, follow **[docs/setup.md](docs/setup.md)** (in Portuguese; any AI assistant can walk you through it in your language). In short:

1. Create the R2 bucket and D1 database, then put your own IDs, email and Access values in `wrangler.jsonc`.
2. Create an R2 API token and add the secrets with `wrangler secret put`.
3. Run `npm run db:migrate:remote` and `npm run deploy`.
4. In Zero Trust, add an Access application on `/admin*` and `/api/admin*` (one-time PIN by email is included).
5. Optionally, run `node scripts/push-key.mjs` to turn on notifications.

**Elsewhere than Cloudflare** (your own server, a NAS, a Raspberry Pi, another host): the code uses Cloudflare's APIs (D1, R2, Access), so it needs a small adapter layer. This means SQLite instead of D1, a folder or any S3-compatible storage instead of R2, and your own login instead of Access. The routes and the whole interface stay the same. [docs/prompts.md](docs/prompts.md) has a prompt for that.

## Make it yours

The project is meant to be changed. Everything is plain TypeScript and Svelte, with the decisions written down in [docs/plano.md](docs/plano.md), so an AI coding assistant (Claude Code, Cursor, Copilot…) can find its way around it quickly. Some ideas:

- **Video review**: frame-accurate comments on cuts, versions of an edit, client links.
- **Photography**: galleries per shoot, guests pick favourites and comment on a point of the image, versions of a retouch.
- **Podcasts or voice-over**: takes as versions, timestamped notes from the producer.
- **Design or artwork**: rounds of a logo or cover, with feedback per round.
- **A label or studio** with several owners, or the interface in English.

Ready-to-paste prompts for these are in **[docs/prompts.md](docs/prompts.md)**.

## Project layout

```
src/worker/   API, share pages, auth, cron clean-up, push (Cloudflare Worker)
src/web/      Interface (Svelte 5): admin/, guest/, comments/, audio/, lyrics/
src/shared/   Code used by both: audio validation, loudness, LRC, guest names
migrations/   D1 schema, in order
public/       Service worker, icons, manifest
docs/         Plan and decisions, setup, free-plan limits, manual checks
test/         Integration tests (Workers pool)
```

Useful commands: `npm run dev`, `npm test`, `npm run check`, `npm run build`, `npm run deploy`.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): use it, change it and run it for yourself, your band, your studio's own work, a school or a non-profit, free of charge. Selling it, or selling access to it as a service, is not allowed. For anything commercial, ask the author.

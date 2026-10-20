# Duggal Badmosh Daily

**A community newspaper that writes itself.** Readers file the stories, an AI desk
rewrites them in house style, and a fresh edition goes live at midnight, every
night, without an editor in the loop.

Built for a Discord community. Runs on free tiers. MIT licensed.

> The paper is autonomous by default. Humans exist only to hold the emergency
> brake, review genuinely risky copy, and fix the occasional typo the robot
> insists is "voice".

---

## What is in the box

| | |
| --- | --- |
| **Website submissions** | Headline, story, author, optional Discord handle, up to 4 photos, category, source link, anonymity. No Discord bot and no OAuth required. |
| **AI newsroom** | Supplied by NVIDIA Nemotron (`nvidia/nemotron-3.5-super-vl-120b-a12b`). Rewrites copy, writes headlines, deks and tags, picks a category, and spots spam. |
| **Autonomy** | Routine stories publish themselves. Only concrete abuse and illegal content is held for a human: credible threats, weapon/explosive/drug/self-harm instructions, private personal data, minors or non-consensual sexual content, protected-group slurs, and active fraud or phishing. Tone, profanity, gossip, sarcasm, roasts, opinions and unverified allegations are **not** holds. Nothing is silently dropped. |
| **Daily editions** | The AI starts assembling tomorrow's edition at **23:00 IST**; it is live at **00:00 IST**. A deterministic fallback layout is used if the AI is unavailable. |
| **Reading experience** | Dynamic front page, breaking ticker, categories, article pages, photo desk, search, tags, archives, editions, awards, corrections, RSS, sitemap and Open Graph images. New stories appear without a redeploy. |
| **Admin console** | Moderation queue, article editor, corrections, job retries, settings, AI diagnostics, audit log, and the kill switch. |
| **Cost** | ₹0/month on Vercel Hobby + Render Free + Turso Free + Vercel Blob (Hobby) + the NVIDIA developer API. |

---

## How it works

```
Reader
  │  headline + story + photos
  ▼
Vercel (Next.js)  ──────────────►  Render (Fastify API)  ──────►  Turso (SQLite)
  │   signed BFF calls                    │  queue + worker           ▲
  │                                       ├─ NVIDIA Nemotron          │
  │                                       └─ sharp → Vercel Blob      │
  │                                                                  │
  └──────────── reads Turso directly (ISR) ──────────────────────────┘
```

1. The browser asks the website's BFF for single-use upload tickets.
2. Photos are `PUT` **directly** to the Render API (Vercel never proxies megabytes).
3. The API validates the submission, hashes the content, stores originals, and
   enqueues an idempotent `process_submission` job.
4. The worker leases the job, runs deterministic heuristics, rewrites the
   copy, and either publishes or parks it for review.
5. Publishing revalidates the relevant website paths. The site is statically
   rendered with ISR, so pages stay fast and fresh.
6. At 23:00 IST the scheduler builds the next edition; at midnight the front
   page simply starts reading the new date.

The queue lives in SQLite, so there is no Redis and no extra service. Leases,
heartbeats, exponential backoff and idempotency keys make it safe to run the
worker in-process **and** from an external cron at the same time.

---

## The nightly cycle (Asia/Kolkata)

| Time | What happens |
| --- | --- |
| **00:00** | The front page rolls over to the edition dated today. Stories are tagged with the edition they will be *read* in. |
| **Every 20s** | In-process worker tick on Render (`WORKER_ENABLED=true`). |
| **Every 5 min** | GitHub Actions calls `POST /internal/worker/tick` as a safety net, and keeps the free Render instance warm. |
| **Hourly** | Expired upload tickets and orphaned photos are cleaned up. |
| **06:00** | Daily recovery: submissions whose AI processing exhausted its attempts are requeued. |
| **Monday ≥12:00** | Weekly awards are generated (configurable weekday). |
| **23:00** | The AI editor starts assembling **tomorrow's** edition. |
| **23:00–00:00** | The edition is finalized; if the AI failed, a deterministic fallback layout is written and retried hourly until 06:00. |

Both `23` and the timezone are settings, not constants:
`autonomy.edition_hour` and `site.timezone` in **Admin → Settings**.

A story filed at 23:40 is still published immediately to the live site; edition
membership is by the date the paper is read, not the minute it was written.

---

## Repository layout

```
.
├─ apps/
│  ├─ api/                  Fastify + TypeScript newsroom brain
│  │  ├─ src/routes/        public, admin, internal, health, media
│  │  ├─ src/services/      ai, moderation, queue, worker, editions, awards
│  │  ├─ src/db/            libsql client, migrations runner
│  │  ├─ scripts/           migrate, seed, create-admin, tick, check-ai
│  │  └─ test/              vitest suite (queue, moderation, schedule…)
│  └─ web/                  Next.js 15 App Router site + admin console
│     ├─ src/app/(public)/  reader-facing pages
│     ├─ src/app/(admin)/   console
│     ├─ src/app/api/       BFF proxies, revalidation, health
│     ├─ src/lib/           queries, HMAC client, sessions, formatting
│     └─ src/components/    design-system components, forms, admin UI
├─ db/migrations/           SQL schema (applied on API startup)
├─ render.yaml              Render Blueprint (health check = /healthz)
├─ .github/workflows/       CI (format, typecheck, lint, tests, builds) + five-minute worker tick
├─ .github/ISSUE_TEMPLATE/  bug and feature request forms
├─ .github/pull_request_template.md
├─ CONTRIBUTING.md          contribution rules and local setup
├─ CODE_OF_CONDUCT.md       community standards and enforcement
├─ SECURITY.md              private vulnerability reporting
└─ package.json             root scripts (no workspaces)
```

---

## Local development

### Prerequisites

- Node.js **20.11+** (Node 22 LTS recommended; the production image uses Node 22)
- npm 10+
- No Docker, no Redis, no Postgres.

### 1. Install

```bash
git clone https://github.com/itsmobsys/duggal_newspaper.git
cd duggal_newspaper
npm run setup
```

### 2. API environment

```bash
cp .env.example .env
```

Generate three independent secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put one each into `SERVICE_SECRET`, `WORKER_TICK_TOKEN` and `SESSION_PEPPER`.
Leave `TURSO_DATABASE_URL=file:../../data/duggal.db` for local SQLite and
`ALLOW_LOCAL_STORAGE=true` so photos land in `.storage/` instead of Vercel Blob.

`NVIDIA_API_KEY` is optional locally. Without it the desk still accepts
submissions and parks them in **queued for review**; the scheduler requeues them
automatically once a key is present. Nothing is lost.

### 3. Create the database

```bash
npm run db:migrate
npm run db:seed            # categories + settings
npm run admin:create -- you@example.com 'a-long-password'
```

Add `--demo` to the seed (`npm run db:seed -- --demo`) if you want six sample
stories to look at. **Never seed demo stories into production.**

### 4. Site environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in:

```dotenv
TURSO_DATABASE_URL=file:../../data/duggal.db
TURSO_AUTH_TOKEN=
API_BASE_URL=http://localhost:8080
SERVICE_SECRET=<same value as the API>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
REVALIDATE_SECRET=<same value as the API>
```

`SERVICE_SECRET` and `REVALIDATE_SECRET` **must be byte-identical** on both
sides. `API_BASE_URL` has no `NEXT_PUBLIC_` prefix on purpose: it is server-only.

### 5. Run

```bash
npm run dev:api     # http://localhost:8080
npm run dev:web     # http://localhost:3000
```

Open <http://localhost:3000> and <http://localhost:3000/admin>.

### Root commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Install both apps |
| `npm run dev:api` / `dev:web` | Dev servers |
| `npm run typecheck` | TypeScript, both apps |
| `npm run lint` | ESLint, both apps |
| `npm run format` / `format:check` | Prettier |
| `npm test` | API test suite (vitest) |
| `npm run build` | Build API (tsup) and site (next build) |
| `npm run verify` | Typecheck + lint + tests + build |
| `npm run worker:tick` | Run one worker tick by hand |
| `npm run db:reset` | Drop and recreate the local database |

---

## Environment variables

### API (Render)

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on Render |
| `PORT` / `HOST` | auto | Render injects `PORT` |
| `WEB_ORIGIN` | yes | Allowed site origin(s), comma-separated |
| `API_PUBLIC_URL` | yes | Public Render URL; used to build upload URLs |
| `TURSO_DATABASE_URL` | yes | `libsql://…` in production |
| `TURSO_AUTH_TOKEN` | yes | Turso token |
| `NVIDIA_API_KEY` | yes | **Server-only.** Never expose or commit |
| `NVIDIA_BASE_URL` | no | Defaults to `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_MODEL` | no | Defaults to `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| `AI_MAX_RPM` | no | Client-side rate cap (default 28) |
| `AI_TIMEOUT_MS` | no | Default 180000 |
| `AI_MAX_ATTEMPTS` | no | Default 5 |
| `AI_TEMPERATURE` / `AI_MAX_TOKENS` | no | Defaults 0.9 / 2600 (answer budget) |
| `AI_REASONING_HEADROOM_TOKENS` | no | Default 6000. Added to `AI_MAX_TOKENS` because Nemotron spends completion tokens on reasoning before writing the answer. |
| `AI_JSON_MODE` | no | Defaults `true`. Falls back to plain JSON parsing if the gateway rejects `response_format`. |
| `SERVICE_SECRET` | yes | HMAC shared with Vercel (≥24 chars) |
| `WORKER_TICK_TOKEN` | yes | Shared with GitHub Actions (≥24 chars) |
| `SESSION_PEPPER` | yes | Admin session hashing (≥24 chars) |
| `ADMIN_SESSION_TTL_HOURS` | no | Default 72 |
| `BLOB_READ_WRITE_TOKEN` | prod | Vercel Blob store token. Public and private stores both work; a private store is detected automatically and photos are served through `GET /media/*`. |
| `BLOB_PRIVATE_READ_WRITE_TOKEN` | no | Separate private store for originals (recommended; otherwise originals go to the main store) |
| `BLOB_CACHE_MAX_AGE_SECONDS` | no | Default 31536000 (one year) |
| `MAX_UPLOAD_BYTES` | no | Per photo, default 8 MiB |
| `MAX_IMAGES_PER_SUBMISSION` | no | Default 4 |
| `UPLOAD_TICKET_TTL_MINUTES` | no | Default 30 |
| `SITE_TIMEZONE` | no | Default `Asia/Kolkata` |
| `WORKER_ENABLED` | no | In-process loop, default `true` |
| `WORKER_INTERVAL_MS` | no | Default 20000 |
| `WORKER_LEASE_MS` | no | Default 300000 |
| `WORKER_MAX_JOBS_PER_TICK` | no | Default 4 |
| `WORKER_BUDGET_MS` | no | Default 90000 |
| `TRUST_PROXY` | no | `true` behind Render |
| `REVALIDATE_URL` | recommended | `https://<site>/api/revalidate` |
| `REVALIDATE_SECRET` | recommended | Shared with Vercel |
| `ALLOW_LOCAL_STORAGE` / `LOCAL_STORAGE_DIR` | local only | Disk fallback |
| `RUN_MIGRATIONS` | no | Set `false` only if you migrate separately |

### Web (Vercel)

| Variable | Required | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | Same database as the API |
| `TURSO_AUTH_TOKEN` | yes | Read/write; the site only reads |
| `API_BASE_URL` | yes | Render URL, **server-only** |
| `SERVICE_SECRET` | yes | Byte-identical to Render |
| `REVALIDATE_SECRET` | yes | Byte-identical to Render |
| `NEXT_PUBLIC_SITE_URL` | yes | Canonical site URL, no trailing slash |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no | Documentation/preview only |

---

## Deployment (free tiers)

Nothing below has been executed for you. Each step is verifiable — do not
assume a deploy worked until the health checks say so.

### 1. Turso

```bash
turso db create duggal-badmosh
turso db show duggal-badmosh --url
turso db tokens create duggal-badmosh
```

Apply the schema from your machine (the API also does this on startup):

```bash
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' npm run db:migrate
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' npm run db:seed
```

Create the owner account with the same environment, then remove the values from
your shell history:

```bash
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' \
  npm run admin:create -- you@example.com 'a-long-password'
```

### 2. Render (API, Docker)

The repository ships a production `Dockerfile`. Render builds that image and
runs it; nothing is installed at deploy time, and the runtime image contains no
source, tests, dev dependencies or secrets.

**Blueprint route (recommended)**

1. **New → Blueprint**, pick this repository. `render.yaml` is detected and
   already declares `runtime: docker`.
2. Fill every `sync: false` variable. At minimum: `WEB_ORIGIN`,
   `API_PUBLIC_URL`, Turso, NVIDIA, the three shared secrets, and the Blob token.
3. Deploy. Watch the log for `database migrations checked` and
   `Duggal Badmosh API is printing`.

**Manual service (identical settings)**

| Setting | Value |
| --- | --- |
| Language / runtime | **Docker** |
| Dockerfile path | `./Dockerfile` |
| Docker build context directory | `.` (repository root — the image needs `db/migrations`) |
| Build command | *(empty — the Dockerfile builds everything)* |
| Start command | *(empty — the image `CMD` is `node dist/server.js`)* |
| Health check path | `/healthz` |
| Instance type | **Free** (512 MB) |
| Port | Render injects `PORT`; the server binds `0.0.0.0:$PORT` |
| Persistent disk | none — Turso and Blob hold all state |
| Auto-deploy | on (or off, if you prefer to ship deliberately) |

What the image guarantees:

- runs as the unprivileged `node` user (uid 1000), never root;
- `NODE_ENV=production` and `--max-old-space-size=320`, sized for the 512 MB
  free instance (raise it in Render if you upgrade the plan);
- `docker stop` reaches the server's SIGTERM handler, so in-flight requests and
  the database connection close cleanly;
- `db/migrations/*.sql` are applied on boot (set `RUN_MIGRATIONS=false` only if
  you migrate separately).

**Build and run the same image locally**

```bash
docker build -t duggal-api .
docker run --rm -p 8080:8080 --env-file .env duggal-api
curl http://localhost:8080/healthz
```

`PORT` and `HOST` come from the environment and default to `8080` / `0.0.0.0`.
With `ALLOW_LOCAL_STORAGE=true` and no Blob token, photos go to `.storage/`, so
you can exercise the full submission flow without touching the cloud.

Create the production admin user from your machine, against Turso (the image has
no dev tooling):

```bash
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' \
  npm run admin:create -- you@example.com 'a-long-password'
```

4. Verify:
   - `https://<service>.onrender.com/healthz` → `200`
   - `https://<service>.onrender.com/readyz` → `200` when DB + AI are configured
     (it reports degraded, not dead, when AI/storage are missing)
5. Set `API_PUBLIC_URL` to the final URL and redeploy if Render assigned a
   different hostname.

`healthCheckPath` is `/healthz` on purpose: liveness should not fail because an
optional integration is missing. `/readyz` is the deeper report for alerts.

### 3. Vercel (website)

1. **Add New Project** → import the repo.
2. **Root Directory:** `apps/web`. Framework preset: Next.js.
3. Add the web environment variables from the table above.
4. Deploy.
5. Set `NEXT_PUBLIC_SITE_URL` to the production domain and add that origin to
   Render's `WEB_ORIGIN`, then redeploy both.
6. Verify `/api/health`, `/sitemap.xml`, `/rss.xml`, and a submission end to end.

The site reads Turso directly, so publishing never waits for a Vercel deploy.

### 4. Photo storage (Vercel Blob, Hobby)

1. Vercel dashboard → **Storage → Create Database → Blob**. Copy the
   **read/write token**.
2. Paste it into Render as `BLOB_READ_WRITE_TOKEN` (server-side only; it is
   never sent to the browser). The store may be **public or private**: on the
   first photo write the API detects a private store, switches that write to
   private access, and serves photos through `GET /media/<key>` on Render
   instead of a Blob URL. Nothing needs to be configured for either mode, and
   `/media` keeps working across restarts.
3. Optional but recommended: create a second Blob store with **private** access
   for untouched originals and set `BLOB_PRIVATE_READ_WRITE_TOKEN`. Without it,
   originals go to the public store under an unguessable random suffix. Original
   files are only ever downloaded by an authenticated admin, never proxied
   publicly.
4. Nothing else to configure: the browser uploads to Render, and Render writes to
   Blob. No bucket policy, no CORS, no public-bucket setup.

Photos are always optimized to WebP before upload, so a private store only adds
one proxy hop for the resized image (typically 150–400 KB), well inside Render's
free bandwidth allowance.


**Hobby limits and what the newsroom does about them**

| Hobby allowance (per month) | This project |
| --- | --- |
| 1 GB storage | soft limit **800 MB** (`storage.soft_limit_mb`) |
| 10,000 simple ops | deletes are free, so cleanup costs nothing |
| 2,000 advanced ops | budget **1,600** (`storage.monthly_advanced_op_limit`, clamped to 2,000); one `put()` = one advanced op |
| 10 GB data transfer | photos are resized before storage; public stores serve them from the Blob CDN, private stores proxy them through Render |

Exceeding the allowance does **not** bill you: Blob becomes inaccessible for
roughly the rest of the 30-day billing period. So the API refuses new photo
uploads *before* that happens (`503 STORAGE_QUOTA_EXHAUSTED`), shows a notice on
the submit page, and keeps accepting **text-only submissions**. Nothing is lost —
the story still publishes without pictures. Originals are kept for 90 days
(`storage.original_retention_days`) and trimmed oldest-first when capacity is
tight; deletes are free. Admins can watch usage, prune early or re-check the
store in **Admin → Diagnostics → Storage**.

Set `BLOB_HOBBY_PLAN`-backed settings in **Admin → Settings → Storage** if you
want stricter limits; the token can be rotated in Render without a code change.

### 5. Five-minute tick

Add two repository secrets:

- `API_BASE_URL` — `https://<service>.onrender.com` (no trailing slash)
- `WORKER_TICK_TOKEN` — identical to Render

The workflow in `.github/workflows/worker-tick.yml` runs every five minutes and
also wakes the free instance. You can trigger it manually from the Actions tab.

Alternatively point UptimeRobot / cron-job.org at `/healthz` every 5 minutes and
keep the in-process worker enabled.

### 6. First-run checklist

- [ ] `/healthz` and `/readyz` on Render
- [ ] `/api/health` on Vercel
- [ ] Admin login works and the cookie is `HttpOnly`
- [ ] A text-only submission publishes (with a valid NVIDIA key)
- [ ] A photo submission stores in Vercel Blob and renders on the article
- [ ] A risky submission lands in **queued for review**
- [ ] `/api/revalidate` is reached after publishing (Render logs)
- [ ] The edition appears at `/edition/<tomorrow>` after 23:00 IST
- [ ] `autonomy.enabled` kill switch stops publishing
- [ ] GitHub Actions tick succeeds

---

## Discord identity (no bot)

The paper deliberately has **no Discord bot and no OAuth app**. Asking for a bot
token would add a moving part and a permission prompt for no reader benefit.

- The submission form has an optional **Discord handle** field.
- Readers type the handle they want credited (e.g. `@badmosh_42`).
- If the desk verifies nothing, it credits nothing: the handle is displayed only
  when the submitter supplies it and does not choose anonymity.
- Anonymous submissions never publish the name or handle, but the API still
  stores them privately for moderation and abuse handling.
- Public contact is the Discord invite/username configured in
  **Admin → Settings → `site.contact_discord`**.

This keeps identity self-declared and unverified, which is the honest position
for an anonymous community paper. Do not present it as verification.

---

## Editorial automation and safety

The model is fixed in configuration and is never silently swapped:

```
nvidia/nemotron-3.5-super-vl-120b-a12b
```

The prompt forbids inventing facts, quotes, people or sources. The server also
enforces this structurally:

- Every submission keeps its **original text and photos**; the AI output is a
  separate rewrite, attributed as AI-assisted.
- Photos are never generated or replaced, and the AI desk never sees the photo
  file. Captions come from the words the submitter attached; the original file
  is what gets served.
- Deterministic moderation runs before the model (blocked domains, banned
  words, private-data and danger patterns, spam heuristics).
- The editorial hold list is short and concrete: credible threats, weapon or
  drug or self-harm instructions, private data about a real person, sexual
  content involving minors or non-consensual sexual content, slurs or hate on
  a protected group, and active fraud or phishing. A hold must quote the
  offending phrase.
- Unverified claims, rumours, gossip, accusations, sarcasm, profanity, roasts,
  controversial opinions and criticism of the powerful are **not** holds. The
  desk is deliberately unhinged, not reckless: it hedges claims ("allegedly")
  and never invents facts or fake verification.
- Routine stories publish automatically (`content.auto_publish`). There is no
  reputation-protection or "misleading risk" score gate.
- Every publish, edit, delete, retry and settings change is written to the
  audit log with an actor and an IP hash.
- If the AI is unavailable, submissions are parked, not lost. Retryable errors
  back off (120s on rate limits, 600s otherwise) and a daily recovery job
  requeues exhausted jobs.

**Emergency kill switches** (no deploy needed):

| Setting | Effect |
| --- | --- |
| `autonomy.enabled = false` | Stops the scheduler: no editions, awards, recovery or auto-requeue |
| `content.auto_publish = false` | Every story is held for a human |
| `WORKER_ENABLED=false` (Render) | Stops the in-process tick; external cron still works |

The admin can also unpublish or delete an article, reject a submission, and
request or publish a correction.

---

## Admin console

`https://<site>/admin` — one owner account, seeded from the CLI, no public
sign-up. Authentication is a database-backed session token in an `HttpOnly`
cookie; the API validates a hashed token on every request. Mutations require a
CSRF double-submit token and a same-origin request.

| Page | Purpose |
| --- | --- |
| Overview | Stats, AI health, failed jobs, latest submissions, manual tick |
| Build now | Process every waiting story and rebuild the front page on demand |
| Submissions | Queue, risk reasons, photos, retry / reject / publish |
| Articles | Edit, publish, unpublish, delete, correct |
| Jobs | Inspect and retry the durable queue |
| Editions | Inspect and rebuild a date |
| Awards | See and add awards |
| Reports | Reader complaints |
| Corrections | Correction requests and their status |
| Categories | Add and enable sections |
| Settings | Live configuration, including the kill switches |
| Diagnostics | AI test call, storage, queue depth |
| Audit log | Every privileged action |

### Building the paper now

`/admin/publish` is the "five stories arrived, I want them live before I walk
away" button:

1. every submission that is still `received`, `failed`, or parked because the AI
   key was missing is put back on the queue;
2. an edition build is queued that **waits for that queue to drain** (up to 15
   minutes) so the new stories cannot miss the paper they triggered;
3. the worker is kicked twice (immediately, then after a minute), and the front
   page, `/latest`, `/editions` and today's edition are revalidated;
4. the response is a receipt — how many stories were queued, whether an AI key
   is configured, whether a tick was requested — not a completion claim.

Nothing unsafe is bypassed: stories held for review stay held, and the normal
moderation rules decide what publishes. The explicit click only overrides the
*autonomy* switches (the kill switch exists to stop unattended runs), and it
never downgrades a finished AI edition to the fallback layout if the AI desk is
unreachable during the rebuild.

Password reset is intentionally not a self-service feature (there is no email
provider). Use:

```bash
npm run admin:create -- you@example.com 'new-long-password' --update
```

with the production Turso environment.

---

## Free-tier reality check

| Service | Free tier | What it means here |
| --- | --- | --- |
| **Vercel Hobby** | Personal/non-commercial, generous bandwidth | Fine for a community paper with no ads. Check Vercel's terms for your use. |
| **Render Free** | 512 MB RAM, 0.1 CPU, sleeps after ~15 min, 750 instance-hours/month | One always-warm service roughly fits in 750 h, but deploys and restarts eat headroom. AI calls are network-bound; image processing is slow but workable. |
| **Turso Free** | Small storage, generous row reads | The database holds text and metadata only. Photos live in object storage. Limits change — check the dashboard. |
| **Vercel Blob (Hobby)** | 1 GB storage, 10,000 simple + 2,000 advanced ops, 10 GB transfer | Plenty for a community paper, and overage suspends access instead of billing. Compress uploads to ≤8 MiB and keep 4 per story. |
| **NVIDIA developer API** | Free credits / rate limits | Rate-limited. `AI_MAX_RPM=28` keeps the client polite. If credits run out, stories wait in the queue. |
| **GitHub Actions** | Free for public repos | A 5-minute cron is ~8,600 runs/month. Keep the workflow lean. |

Free tiers change. The code only assumes: HTTP, SQLite-compatible SQL, and a
Vercel Blob token. Nothing here requires a paid plan to run locally.

---

## Security model

- The Render API is **closed** to direct browser calls except `PUT /public/uploads/:id`
  (bearer ticket) and the read-only `/media/*` route (local disk in development,
  proxied private Blob reads in production).
- Every other request is signed by the Next.js BFF with HMAC-SHA256 over
  `timestamp \n METHOD \n pathWithQuery \n sha256(body)`. Requests older than
  the allowed window are rejected.
- Upload tickets are single-use, expiring, and stored hashed.
- Photos are validated by magic bytes, re-encoded with `sharp`, stripped of
  metadata, and given random object keys.
- Admin sessions are hashed in the database and carried in an `HttpOnly`,
  `SameSite=Lax`, `Secure` cookie. The token never reaches client JavaScript.
- CSRF uses double-submit; the BFF checks `Origin` on every mutation.
- Uploads and public writes are rate-limited per IP hash. Rate limits are
  cleaned up hourly.
- AI output is treated as untrusted input: plain text only, no HTML, no
  markdown execution, escaped at render time.
- Errors returned to clients are safe messages with stable codes; stack traces
  stay in server logs.
- Secrets live only in Render/Vercel environment variables. `.env` files are
  gitignored. `.env.example` contains no real values.

If you find a security issue, please do not open a public issue with an exploit.
Report it privately through [GitHub Security Advisories](https://github.com/itsmobsys/duggal_newspaper/security/advisories/new)
or as described in [SECURITY.md](SECURITY.md).

---

## Testing and quality gates

```bash
npm run verify
```

runs typecheck, lint, the API test suite and both production builds. The suite
covers the queue (leases, backoff, idempotency), moderation, edition scheduling
(including the 23:00 IST build), uploads, and the public/admin route contracts.

Formatting is enforced with Prettier (`npm run format:check`); ESLint runs with
`--max-warnings=0`. The same checks run in GitHub Actions on every push and pull
request, so a contributor finds out before a maintainer has to look.

---

## Troubleshooting

**Submissions sit in `queued_review`.**
`NVIDIA_API_KEY` is missing or invalid. The desk parks work instead of dropping
it. Add the key, then either wait for the scheduler or run a tick from the
dashboard. Check **Admin → Diagnostics**.

**The API takes 30–60s to answer.**
Render Free is waking up. The five-minute pinger prevents this in normal
operation. The BFF already shows a "waking up" message on 502s.

**Photos return 503 `STORAGE_NOT_CONFIGURED`.**
Vercel Blob is not configured. Set `BLOB_READ_WRITE_TOKEN` on Render, or use
`ALLOW_LOCAL_STORAGE=true` locally. Readers can still submit text-only stories.

**Photos return 503 `STORAGE_QUOTA_EXHAUSTED`.**
The Hobby allowance is used up (800 MB soft limit or the monthly advanced-op
budget). Blob would be suspended anyway, so uploads stop early instead of
failing halfway. Text submissions keep working. Free space in **Admin →
Diagnostics → Storage → Prune originals**, raise `storage.soft_limit_mb`, or wait
for next month's reset.

**Photos return 503 `STORAGE_DEGRADED`.**
A photo write just failed, so the API pauses photo intake for five minutes
instead of hammering a store that is unhappy. The pause clears itself; admins
can also hit **Admin → Diagnostics → Storage → Re-check** to retry immediately.
Text submissions are unaffected.

**`/readyz` says degraded but the site works.**
That is intentional: missing AI or storage is a degraded capability, not a dead
service. `/healthz` stays 200 while the process is alive.

**A new story does not appear immediately.**
ISR revalidation is asynchronous. Publishing calls `/api/revalidate`; if
`REVALIDATE_URL`/`REVALIDATE_SECRET` are missing, pages refresh on their own
`revalidate` timer instead. Check the Render logs for `revalidate`.

**The midnight edition is missing.**
Confirm `autonomy.enabled`, `autonomy.daily_edition`, `autonomy.edition_hour`
and the worker tick. A fallback edition is written even if the AI call fails;
look for `generated_by = 'fallback'` in **Admin → Editions**.

**CORS errors on login or submission.**
`WEB_ORIGIN` must match the browser origin exactly (scheme + host, no trailing
slash). Comma-separate preview domains. On Vercel previews, add the preview
origin or test on the production domain.

**`gh`/git prints progress to stderr and looks like a failure.**
It usually succeeded. Verify with `git status -sb` or `git ls-remote`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep it free, keep it honest, and do not
add a dependency that could be twelve lines of code.

- Bug reports and feature requests: use the issue templates.
- Pull requests: describe the change, link the issue, and say which tests cover
  it. CI must be green; `npm run verify` is the same gate locally.
- Security issues: never a public issue. Use [SECURITY.md](SECURITY.md).
- Behave like a person. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies.

## License

MIT — see [LICENSE](LICENSE).

The name, the community and the bad decisions are not transferable. The code is.

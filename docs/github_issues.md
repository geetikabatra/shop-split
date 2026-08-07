# GitHub Issues — docs/ tracking

Follow-up items not yet folded into the main `GITHUB_ISSUES.md` at the repo root.

Tracks the "Harden production deployment configuration" work
(`GITHUB_ISSUES.md`) broken into phases: Cloud Run (web) + Supabase
(Postgres), chosen over Fly.io/Render mainly on cost (Cloud Run's free
tier + a free-tier external Postgres can stay near $0/month at low
traffic; see conversation for the full comparison).

---

## [PARTIALLY RESOLVED] Phase 1: Provision production Postgres (Supabase)
**Labels:** backend, production-readiness, deployment

Set up a real, hosted Postgres instance for production, separate from the
local docker-compose one used for dev/tests.

**Done:**
- Supabase project created, database password set
- `prisma/schema.prisma` updated with a `directUrl` field -- Supabase's
  transaction pooler (port 6543) doesn't support the session-level features
  `prisma migrate deploy` needs (hit this for real: `P1017 Server has
  closed the connection`), so migrations now run against the direct/unpooled
  connection (`DIRECT_URL`) while the app's normal runtime queries use the
  pooled connection (`DATABASE_URL`)
- `.env.example` and local `.env` updated to document/set `DIRECT_URL`
- Migration applied successfully to Supabase; verified live via a direct
  query that all 7 tables exist (`Shop`, `Experiment`, `Variant`,
  `Assignment`, `Event`, `Session`, `_prisma_migrations`)

**Still open:** the database password was pasted into chat twice during
setup and needs rotating before it's used as the real production secret in
Cloud Run -- tracked separately below ("Rotate exposed Supabase production
database password") since it needs to happen regardless of how deployment
itself proceeds.

**Acceptance criteria**
- [x] Production Postgres instance provisioned
- [x] Migrations applied and verified against it
- [x] Connection string strategy resolved for the pooler-vs-migrations
      conflict
- [ ] Password rotated (see the dedicated issue below)

---

## Rotate exposed Supabase production database password
**Labels:** security, production-readiness

During Phase 1 of production deployment hardening (setting up the Supabase
Postgres instance for Cloud Run), the database password was pasted directly
into the AI assistant chat twice -- once as part of the pooled connection
string, once as part of the direct connection string. Both instances of the
password should be treated as compromised, since that conversation may be
logged or stored.

**Acceptance criteria**
- [ ] Reset the database password in Supabase (Project Settings → Database →
      Reset database password)
- [ ] Update any local `.env`/`DATABASE_URL`/`DIRECT_URL` values that
      reference the old password
- [ ] Confirm no deployed secret (e.g. a Cloud Run Secret Manager entry) was
      created with the old password before rotation -- if one was, update it
      too

---

## Phase 2: GCP project + Cloud Run/Artifact Registry setup
**Labels:** setup, production-readiness, deployment
**Depends on:** Phase 1 (production Postgres)

Provision the GCP-side infrastructure the app will actually deploy into.
Needs your own GCP account/billing -- not something that can be done without
your interactive login.

**Acceptance criteria**
- [ ] GCP project created (or an existing one chosen), billing enabled
- [ ] Required APIs enabled: Cloud Run, Artifact Registry, Cloud Build
- [ ] `gcloud auth login` completed locally
- [ ] Artifact Registry Docker repository created
      (`gcloud artifacts repositories create shopsplit --repository-format=docker --location=<region>`)

---

## [PARTIALLY RESOLVED] Phase 3: Build, push, and deploy the container to Cloud Run
**Labels:** backend, production-readiness, deployment
**Depends on:** Phase 2 (GCP setup)

Get the actual app running on Cloud Run, with secrets handled properly
rather than as plain env vars.

**Done:**
- Image built and pushed via `gcloud builds submit` to
  `asia-northeast1-docker.pkg.dev/shopsplit-prod/shopsplit/app` (Cloud
  Build handled it, no local Docker auth needed)
- `DATABASE_URL` (pooled, port 6543), `SHOPIFY_API_SECRET`, and (a late
  addition -- see below) `DIRECT_URL` all stored in Secret Manager, with
  the Cloud Run service account explicitly granted
  `roles/secretmanager.secretAccessor` on each (deploy fails without this;
  it's not automatic)
- `gcloud run deploy` succeeded; service live at
  `https://shopsplit-537256850164.asia-northeast1.run.app` (confirmed via
  `curl -I`, HTTP 200)
- Confirmed live: `react-router-serve` binds to Cloud Run's injected
  `PORT` correctly with zero Dockerfile changes

**Two real gotchas hit and fixed along the way, worth knowing about for
future redeploys:**
1. The Dockerfile's `docker-start` script runs `prisma migrate deploy` on
   every container boot, which (per the Phase 1 `directUrl` fix) needs
   `DIRECT_URL`, not just `DATABASE_URL` -- missing it would have crashed
   every cold start. Added a third secret (`shopsplit-direct-url`) so this
   keeps working as-is, rather than restructuring the startup script.
2. `shopify-app.ts` hard-crashes at boot (`Error: Detected an empty
   appUrl configuration`) if `SHOPIFY_APP_URL` isn't set -- it can't be
   deferred to "set it after the first deploy" the way the original plan
   assumed. Worked around it because Cloud Run's URL turned out to be
   deterministic (`https://<service>-<project-number>.<region>.run.app`,
   confirmed via `gcloud run services describe` even before a successful
   revision existed), so it could be computed and set correctly on the
   very first deploy attempt.

**Still open:**
- [ ] Consider adding Upstash Redis (`REDIS_URL`) -- Cloud Run's
      multi-instance/scale-to-zero model means the in-memory
      rate-limiter fallback doesn't share state across instances, so the
      shared-store rate limiting from `app/utils/rate-limit.server.ts`
      only actually applies in production if `REDIS_URL` is set. Not done
      yet.
- [ ] (Optional) Custom domain mapped instead of the default `*.run.app`
      one, for free managed HTTPS
- [ ] The Supabase database password used in the `DATABASE_URL`/
      `DIRECT_URL` secrets is still the one exposed in chat during Phase 1
      (rotation deferred by choice, tracked in the dedicated password
      -rotation issue above) -- once rotated, these two secrets need
      `gcloud secrets versions add` with the new value

---

## [RESOLVED] Phase 4: Wire the production URL back into Shopify
**Labels:** setup, production-readiness, deployment
**Depends on:** Phase 3 (Cloud Run deployment)

Point the Shopify app config at the real, stable production URL instead of
the placeholder/tunnel URL it currently has.

**Done:**
- `shopify.app.toml` updated: `application_url`, `[auth] redirect_urls`,
  `[app_proxy] url` all point at
  `https://shopsplit-537256850164.asia-northeast1.run.app`
- `shopify app deploy --allow-updates` run successfully; released as app
  version `shopsplit-2`, then `shopsplit-3` (see below)
- As a side effect, the CLI also dropped `include_config_on_deploy` from
  `shopify.app.toml` on its own -- that field is no longer supported and
  this is expected automatic cleanup, not a manual edit

**Verified live end to end**, not just structurally: opened the app fresh
from the Shopify admin, completed a real OAuth install against the
production URL, and confirmed both a real `Session` row landed in the
production Supabase database (`shop: shopsplit-z1lscgsw.myshopify.com`)
and the actual app UI rendered correctly in the embedded admin.

**Two real bugs found and fixed to get there:**

1. **A still-running `shopify app dev` process was overriding the
   production config.** It had been running continuously since before
   this deployment work started, and `shopify.app.toml` has
   `automatically_update_urls_on_dev = true`. The embedded admin kept
   loading the dead dev tunnel (`edition-ons-scenes-casinos.trycloudflare.com`)
   instead of Cloud Run, even after a successful `shopify app deploy`.
   There's also a separate, persistent "dev preview" association (visible
   in Shopify admin's own "Dev Console" panel, with a "Clean dev preview"
   button) that outlives the local process and has to be cleared
   independently -- killing the process alone wasn't enough. Fixed by
   stopping `shopify app dev`, clicking "Clean dev preview" in that
   panel, and re-running `shopify app deploy` (released as `shopsplit-3`).
2. **Secret Manager values had a trailing newline byte.** All three
   secrets were created with a bash here-string (`<<< "value"`), which
   silently appends `\n`. Postgres connection string parsers tolerate
   trailing whitespace, so `DATABASE_URL`/`DIRECT_URL` worked fine
   despite this -- but HMAC signature verification is byte-exact, so the
   corrupted `SHOPIFY_API_SECRET` caused every embedded app load to fail
   with a bare `401 Unauthorized`. Confirmed via `gcloud secrets versions
   access ... | xxd` (trailing `0a` byte). Fixed by adding new versions
   of all three secrets via `printf '%s' "value" | gcloud secrets
   versions add ...` instead, then forcing a new Cloud Run revision
   (`:latest` is resolved once at container start, not live-refreshed)
   with `gcloud run services update --set-secrets=...`.

**Acceptance criteria**
- [x] `shopify.app.toml` updated: `application_url`, `[auth] redirect_urls`,
      `[app_proxy] url` all point at the Cloud Run URL (or mapped custom
      domain)
- [x] `shopify app deploy` run to push the config to Shopify (interactive
      CLI login required)
- [x] `SHOPIFY_APP_URL` and related values verified correct in the deployed
      environment itself -- confirmed via a real end-to-end OAuth install
      (live Session row in production Supabase, app UI rendered correctly)

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

## Phase 3: Build, push, and deploy the container to Cloud Run
**Labels:** backend, production-readiness, deployment
**Depends on:** Phase 2 (GCP setup)

Get the actual app running on Cloud Run, with secrets handled properly
rather than as plain env vars.

**Acceptance criteria**
- [ ] Image built and pushed via `gcloud builds submit` (no local Docker
      auth juggling needed -- Cloud Build handles it)
- [ ] `DATABASE_URL` (pooled, port 6543) and `SHOPIFY_API_SECRET` stored in
      Secret Manager, not passed as plain `--set-env-vars`
- [ ] `gcloud run deploy` succeeds; service reachable at its
      `*.run.app` URL
- [ ] Confirm `react-router-serve` actually binds to Cloud Run's injected
      `PORT` (verified locally that it respects `process.env.PORT`, but not
      yet confirmed against a real Cloud Run instance)
- [ ] Consider adding Upstash Redis (`REDIS_URL`) at this step -- Cloud
      Run's multi-instance/scale-to-zero model means the in-memory
      rate-limiter fallback doesn't share state across instances, so the
      shared-store rate limiting from `app/utils/rate-limit.server.ts`
      only actually applies in production if `REDIS_URL` is set
- [ ] (Optional) Custom domain mapped for a stable URL instead of the
      default `*.run.app` one, for free managed HTTPS

---

## Phase 4: Wire the production URL back into Shopify
**Labels:** setup, production-readiness, deployment
**Depends on:** Phase 3 (Cloud Run deployment)

Point the Shopify app config at the real, stable production URL instead of
the placeholder/tunnel URL it currently has.

**Acceptance criteria**
- [ ] `shopify.app.toml` updated: `application_url`, `[auth] redirect_urls`,
      `[app_proxy] url` all point at the Cloud Run URL (or mapped custom
      domain)
- [ ] `shopify app deploy` run to push the config to Shopify (interactive
      CLI login required)
- [ ] `SHOPIFY_APP_URL` and related values verified correct in the deployed
      environment itself, not just locally (per the existing acceptance
      criteria in `GITHUB_ISSUES.md`'s "Harden production deployment
      configuration" issue)

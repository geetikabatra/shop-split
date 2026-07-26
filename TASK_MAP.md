# Shopify A/B Testing Plugin — Task Map

**Working name:** ShopSplit (placeholder — rename freely)

**What it does:** Lets merchants A/B test storefront elements — product page layout, CTAs,
pricing display, banners, images — without editing theme code, using Theme App Extensions.
Merchants create experiments and variants in an embedded admin UI, traffic is split and
tracked, and results are shown with conversion rate + statistical significance.

**Stack:** Shopify Remix app template (Remix + Polaris + App Bridge) · Admin GraphQL API ·
Theme App Extensions (App Blocks) · App Proxy for storefront data · Prisma + Postgres ·
Shopify Billing API · mandatory GDPR webhooks.

**Target:** Public Shopify App Store listing (built so a private/single-store cut is a subset).

---

## Milestone 0 — Project Setup & Scaffolding
Foundation: repo, Shopify CLI app, dev store, CI.
- [x] Scaffold app with Shopify CLI (React Router template — Shopify's current default, successor to the Remix template)
- [x] Configure `shopify.app.toml` (scopes, webhooks, app proxy) — scopes/webhooks present from scaffold; app proxy path still needs setting for Milestone 3
- [x] Set up Prisma + Postgres (dev via SQLite or Docker Postgres) — SQLite dev datasource in place; swap to Postgres before production deploy
- [ ] Set up dev store + test theme for local testing — needs interactive `shopify app dev` run by you (opens browser to pick/create a dev store)
- [x] CI pipeline (lint, typecheck, test) on PR — `.github/workflows/ci.yml`, runs against a real ephemeral Postgres service container (matches the `postgres:16-alpine` used locally); verified locally end-to-end (fresh `prisma generate` + `migrate deploy` + lint + typecheck + full 55-test suite, ~3s test runtime)

## Milestone 1 — Core Data Model & Admin API
The schema and server-side API everything else builds on.
- [x] Design schema: Experiment, Variant, Assignment, Event, Shop
- [x] Prisma models + migrations
- [x] Experiment CRUD (loaders/actions in `app/models/experiment.server.ts`, `app/routes/app.experiments.*`)
- [x] Variant CRUD nested under Experiment (`app/models/variant.server.ts`)
- [x] Traffic allocation logic (weighted split, must sum to 100%)
- [x] Experiment status state machine (draft → running → paused → completed)

## Milestone 2 — Experiment Management UI (Admin)
Merchant-facing embedded app screens.
- [x] Experiments list page (Polaris web components table, status badges)
- [x] Create/edit experiment flow (target element, goal metric); variant setup happens on the detail page
- [x] Variant editor (name, control flag, weight, free-text content override)
- [x] Product/page picker (Shopify resource picker via App Bridge) — `app/routes/app.experiments.new.tsx` now calls `shopify.resourcePicker({ type: "product", action: "select" })` via `useAppBridge`, storing the returned GID in a hidden `targetResourceId` field; verified via typecheck/lint/full test suite (not yet exercised in a live embedded-admin browser session, which needs an interactive `shopify app dev` run)
- [x] Start/pause/stop experiment controls + confirmation states (state machine enforced server-side; no confirm-dialog yet on Complete)
- [x] Empty state for zero experiments — onboarding walkthrough still pending

## Milestone 3 — Storefront Variant Delivery
Getting variants onto the live storefront without theme code edits.
- [x] Build Theme App Extension (App Block) for target sections (product page, banner)
- [x] App Proxy endpoint to serve active experiment/variant config for a page
- [x] Client-side loader script: fetch config, apply variant DOM changes
- [x] Fallback/graceful-degradation when no active experiment (fails closed to the block's default content on any error/timeout/no-experiment)
- [x] Performance check: minimize layout shift / flicker on variant swap — blocks start `visibility: hidden` (not `display: none`, so layout space is reserved) and the loader reveals them only once a variant is applied or "no experiment" is confirmed, with a hard timeout backstop so a slow/failed request never leaves a block permanently hidden (production-readiness pass)

Verified live on shopsplit-z1lscgsw.myshopify.com: added the ShopSplit
Product CTA block to a real product page, started an experiment with two
variants, and confirmed the storefront text flips between variant content
on reload.

## Milestone 4 — Visitor Bucketing & Event Tracking
Deciding who sees what, and recording what happens.
- [x] Deterministic bucketing (hashed visitor ID → variant, sticky via cookie) — client-side FNV-1a hash of visitorId+experimentId against the (immutable-once-RUNNING) weight table; server upserts an Assignment as the durable record, first-write-wins
- [x] Impression tracking event (variant shown)
- [x] Conversion tracking: add-to-cart event (fetch-patch detecting `/cart/add` calls, works with AJAX themes like Dawn/Horizon)
- [x] Conversion tracking: purchase event (orders/paid webhook; cart attributes carry the experiment/variant/visitor tag through to the order's note_attributes for attribution; idempotent on webhook retries via the orderId+type unique constraint)
- [x] Event ingestion endpoint with basic rate limiting/validation (in-memory fixed-window limiter — documented as needing a shared store like Redis for a multi-instance production deployment)
- [x] Data retention / cleanup job for old events (`npm run cleanup-events -- --days N`; no in-app scheduler, needs an external cron)

17 unit tests total (added 6 for event recording: assignment stickiness,
rejecting a variant that doesn't belong to the experiment, rejecting
events for non-running experiments, allowing PURCHASE for paused/completed
experiments, purchase idempotency).

Verified live end-to-end on shopsplit-z1lscgsw.myshopify.com: impression on
page load, cart tagged with the experiment/variant/visitor on "Add to
cart," and a real test order (Bogus Gateway) produced a PURCHASE event via
the orders/paid webhook, correctly attributed to the assigned variant.
Two fixes required to get there, both now in code:
- shopify.app.toml alone doesn't register webhooks for `app dev` sessions;
  added an `afterAuth` hook in app/shopify.server.ts calling
  `registerWebhooks` explicitly.
- Add-to-cart detection needs both the fetch-patch and a native
  form-submit fallback, since not all "Add to cart" paths go through
  `fetch`.

"Buy it now" accelerated checkout bypassed both add-to-cart detectors
(found during the live verification above). Tagging the cart at
impression time (instead of on an add-to-cart signal) turned out not to
fix it either -- verified live that the cart was tagged correctly, but
the order still had zero attribution, because dynamic checkout buttons
build a separate checkout session that never reads the cart at all.
Actual fix: hide the dynamic checkout button during a PURCHASE-goal
experiment, forcing visitors through the trackable Add to cart ->
Checkout path. That's a workaround (merchants lose that checkout option
during the experiment), not true "Buy it now" tracking -- tracked as a
separate open issue in GITHUB_ISSUES.md.

## Milestone 5 — Results & Statistics Engine
Turning raw events into a decision merchants can trust.
- [x] Aggregate impressions/conversions per variant (`app/models/results.server.ts`; visitors = distinct Assignments, conversions = distinct assignments with an event matching the experiment's goal, so repeat conversions by one visitor don't inflate the rate)
- [x] Conversion rate + revenue-per-visitor calculations
- [x] Statistical significance (two-proportion z-test, `app/utils/stats.server.ts`, each variant vs control)
- [x] Results dashboard UI (table on the experiment detail page: visitors, conversions, conversion rate, revenue/visitor, confidence vs control, "Winner" badge)
- [x] Minimum sample size guardrail before declaring significance (30/variant; shows "Not enough data yet" below that instead of a number)
- [x] Export results (CSV) — `/app/experiments/:id/export`

10 new unit tests (27 total): z-test correctness/symmetry/thresholds against
known cases, aggregation math against seeded events, double-conversion
dedup, and the sample-size guardrail.

## Milestone 6 — Billing & Monetization
- [x] Define pricing tiers (experiment count / traffic volume limits) — Free: 1 active (non-Completed) experiment at a time; Growth ($9.99/mo): unlimited
- [x] Integrate Shopify Billing API (subscription + usage-based option) — subscription only; `app/shopify.server.ts` billing config + `billing.request`/`billing.check`/`billing.cancel`
- [x] Plan enforcement (block new experiments over tier limit) — enforced server-side in the create-experiment action, not just the UI
- [x] Billing settings page + upgrade prompts — `/app/billing`; upgrade CTA also surfaces inline when experiment creation is blocked

3 new unit tests (31 total) for plan-limit logic. Note: `billing.request`
is called with `isTest: true` for now since this app is pre-launch --
needs revisiting before a real production launch (tracked in the
deployment-hardening issue in GITHUB_ISSUES.md) so real merchants are
actually charged.

Also hit the same client/server import-leak build error as Milestone 5,
twice, for the same underlying reason: React Router treats every export
of a `.server.ts` file as server-only, including plain constants a route
component wants to display directly. Fixed by keeping billing plan
names/limits in a dedicated non-`.server` file
(`app/models/billing-plans.ts`) instead of threading each new constant
through a loader one at a time.

## Milestone 7 — Compliance, Security & GDPR
- [x] Implement mandatory webhooks: `customers/data_request`, `customers/redact`, `shop/redact` — first two just acknowledge (no customer-linked data is ever stored); shop/redact does a real purge via cascade delete
- [x] `app/uninstalled` cleanup — clears the Session row only, by design; full data purge deliberately waits for `shop/redact` (~48h later) in case of reinstall, not immediately on uninstall
- [x] Data encryption at rest for PII — assessed as not applicable: visitorId is an app-generated anonymous string, never linked to a Shopify customer identity, email, or name, so there's no PII in our tables to encrypt
- [ ] Privacy policy + data processing documentation — not started; this is merchant-facing legal/policy content, not code, and needs to be written by/with the app owner before App Store submission
- [x] Session token / OAuth security review (embedded app auth) — see GITHUB_ISSUES.md; no cross-tenant leaks found, every mutation gated by an ownership check before touching a row by bare ID
- [x] Rate limiting & input validation on public App Proxy endpoint — found and fixed a real gap: the limiter was keyed by attacker-controlled visitorId alone, trivially bypassed by rotating fake IDs; now also rate-limited by client IP

5 new unit tests (36 total): shop-deletion cascade correctness, rate
limiter behavior, and getClientIp header parsing.

## Milestone 8 — Testing & QA
- [x] Unit tests: bucketing determinism, allocation math, stats engine — bucketing determinism was the real gap (previously only verified via ad-hoc `node -e` scripts during live debugging); `app/utils/shopsplit-loader.script.test.ts` now loads and executes the actual shipped script in jsdom
- [x] Integration tests: experiment CRUD, webhook handlers — route-level tests mocking only the Shopify SDK auth boundary, everything below runs for real against the test database
- [x] E2E test: create experiment → visit storefront → verify variant + event recorded — `app/models/full-pipeline.e2e.test.ts` simulates the full model-layer pipeline; genuine manual E2E (real browser, real dev store, real Postgres) was also done extensively earlier this session and is what actually caught the real bugs (webhook registration, Buy it now gap) that a simulation can't reach
- [x] Load test App Proxy endpoint (storefront traffic spikes) — `scripts/load-test.ts` (`npm run load-test`), hits the real getActiveExperimentForTarget/recordEvent model-layer functions with real concurrency against real Postgres (skips HTTP/HMAC layer deliberately -- that's cheap, the database is the actual bottleneck). Results at concurrency 200: read path ~9,100 req/s (p50 19ms, p99 60ms), write path ~2,800 req/s (p50 71ms, p99 81ms), zero errors at either concurrency tested (50 and 200). Throughput plateaus rather than degrading -- looks like single-connection saturation, not an instability problem, but only tested against one local Postgres instance from one process; real production capacity depends on connection pooling sized for the target host (see GITHUB_ISSUES.md)
- [ ] Manual QA across 2–3 popular free themes (Dawn, etc.) — needs your browser; see the checklist

## Milestone 9 — App Store Submission & Launch
- [ ] App listing copy, screenshots, demo video
- [ ] Shopify App Store review checklist pass (performance, security, UX requirements)
- [ ] Submit for review
- [ ] Address review feedback
- [ ] Public launch

## Milestone 10 — Post-launch
- [ ] Merchant onboarding docs / help center
- [ ] In-app support widget or contact flow
- [ ] Usage analytics/telemetry for the app itself
- [ ] Roadmap: multi-variant (A/B/n), audience targeting, checkout extensibility tests

---

## Production readiness pass (between Milestones 7 and 8)

Worked through most of the production-readiness backlog from
GITHUB_ISSUES.md before continuing to Milestone 8, since QA on an app
that isn't production-shaped yet has limited value. Done:
- Anti-flicker storefront handling
- GitHub Actions scheduled event cleanup
- Sentry error monitoring (code-only, no account yet)
- afterAuth failure handling (partial -- see GITHUB_ISSUES.md for the
  real open gap around stale-session detection, which is a library
  limitation we can't fix from application code)
- Redis-backed rate limiting, **verified against a real local Redis
  container** (inspected the key/TTL/count directly via redis-cli)
- Postgres migration, **verified against a real local Postgres
  container** (full test suite passed against it, not just SQLite)

Still open: deployment hosting (deliberately skipped -- real
cost/provider decision, not made unilaterally), connection pooling and
concurrent-load testing (need a real production host to be meaningful).
Multi-tenant scoping audit is done (see GITHUB_ISSUES.md's security
review, completed earlier in Milestone 7).

---

## Dependency notes
- Milestone 1 blocks 2, 3, 4.
- Milestone 3 and 4 can run in parallel once 1 is done.
- Milestone 5 depends on 4 (needs real event data).
- Milestone 6 and 7 can start early, in parallel with 2–5.
- Milestone 9 requires 5, 6, 7, 8 complete.

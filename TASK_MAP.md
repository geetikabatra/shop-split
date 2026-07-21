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
- [ ] CI pipeline (lint, typecheck, test) on PR

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
- [ ] Product/page picker (Shopify resource picker via App Bridge) — currently a plain text field for product GID
- [x] Start/pause/stop experiment controls + confirmation states (state machine enforced server-side; no confirm-dialog yet on Complete)
- [x] Empty state for zero experiments — onboarding walkthrough still pending

## Milestone 3 — Storefront Variant Delivery
Getting variants onto the live storefront without theme code edits.
- [x] Build Theme App Extension (App Block) for target sections (product page, banner)
- [x] App Proxy endpoint to serve active experiment/variant config for a page
- [x] Client-side loader script: fetch config, apply variant DOM changes
- [x] Fallback/graceful-degradation when no active experiment (fails closed to the block's default content on any error/timeout/no-experiment)
- [ ] Performance check: minimize layout shift / flicker on variant swap — script is deferred and swaps text post-render, so some flicker is expected; not yet measured or optimized

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
  `fetch` ("Buy it now" uses an accelerated checkout that skips both --
  a known gap, not yet handled).

## Milestone 5 — Results & Statistics Engine
Turning raw events into a decision merchants can trust.
- [ ] Aggregate impressions/conversions per variant
- [ ] Conversion rate + revenue-per-visitor calculations
- [ ] Statistical significance (two-proportion z-test or sequential testing)
- [ ] Results dashboard UI (Polaris charts, confidence indicator, "declare winner")
- [ ] Minimum sample size guardrail before declaring significance
- [ ] Export results (CSV)

## Milestone 6 — Billing & Monetization
- [ ] Define pricing tiers (experiment count / traffic volume limits)
- [ ] Integrate Shopify Billing API (subscription + usage-based option)
- [ ] Plan enforcement (block new experiments over tier limit)
- [ ] Billing settings page + upgrade prompts

## Milestone 7 — Compliance, Security & GDPR
- [ ] Implement mandatory webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] `app/uninstalled` cleanup (purge shop data)
- [ ] Data encryption at rest for PII (if any visitor data stored)
- [ ] Privacy policy + data processing documentation
- [ ] Session token / OAuth security review (embedded app auth)
- [ ] Rate limiting & input validation on public App Proxy endpoint

## Milestone 8 — Testing & QA
- [ ] Unit tests: bucketing determinism, allocation math, stats engine
- [ ] Integration tests: experiment CRUD, webhook handlers
- [ ] E2E test: create experiment → visit storefront → verify variant + event recorded
- [ ] Load test App Proxy endpoint (storefront traffic spikes)
- [ ] Manual QA across 2–3 popular free themes (Dawn, etc.)

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

## Dependency notes
- Milestone 1 blocks 2, 3, 4.
- Milestone 3 and 4 can run in parallel once 1 is done.
- Milestone 5 depends on 4 (needs real event data).
- Milestone 6 and 7 can start early, in parallel with 2–5.
- Milestone 9 requires 5, 6, 7, 8 complete.

# GitHub Issues — ShopSplit (Shopify A/B Testing Plugin)

Companion to `TASK_MAP.md`. Each `##` heading below is one issue: title, labels,
milestone, description, and acceptance criteria. Copy-paste into GitHub, or use
the `gh` snippet at the bottom to bulk-create once this repo has a GitHub remote.

**Suggested labels to create first:** `setup`, `backend`, `frontend`, `storefront`,
`data`, `billing`, `compliance`, `testing`, `launch`, `good-first-issue`, `blocked`.

**Suggested milestones:** `M0 Setup`, `M1 Data & API`, `M2 Admin UI`, `M3 Storefront Delivery`,
`M4 Bucketing & Tracking`, `M5 Results & Stats`, `M6 Billing`, `M7 Compliance`, `M8 QA`, `M9 Launch`.

---

## Scaffold app with Shopify CLI (Remix template)
**Labels:** setup, backend
**Milestone:** M0 Setup

Initialize the app using `shopify app init` with the Remix template. Verify it runs
locally against a dev store via `shopify app dev`.

**Acceptance criteria**
- [ ] App boots locally and installs on a dev store
- [ ] Embedded admin loads inside Shopify admin iframe
- [ ] Repo committed with `.gitignore` for env/secrets

---

## Configure shopify.app.toml (scopes, webhooks, app proxy)
**Labels:** setup, backend
**Milestone:** M0 Setup

Declare required Admin API scopes (`read_products`, `write_products` as needed),
register mandatory GDPR webhooks, and configure the App Proxy path (e.g. `/apps/shopsplit`).

**Acceptance criteria**
- [ ] Scopes match what M1–M4 actually need (least privilege)
- [ ] App proxy URL resolves to the app's storefront endpoint
- [ ] Config deploys via `shopify app deploy` without errors

---

## Set up Prisma + Postgres
**Labels:** setup, backend, data
**Milestone:** M0 Setup

Add Prisma ORM with a Postgres provider for production and SQLite (or dockerized
Postgres) for local dev.

**Acceptance criteria**
- [ ] `prisma migrate dev` runs cleanly on a fresh checkout
- [ ] Connection config via env var, documented in README
- [ ] Seed script for local test data

---

## Set up CI pipeline
**Labels:** setup, testing
**Milestone:** M0 Setup

GitHub Actions workflow running lint, typecheck, and unit tests on every PR.

**Acceptance criteria**
- [ ] CI fails the PR on lint/type/test errors
- [ ] Runs in under 5 minutes on a typical PR

---

## Design schema: Experiment, Variant, Assignment, Event, Shop
**Labels:** data, backend
**Milestone:** M1 Data & API

Define the Prisma schema covering: `Shop` (tenant), `Experiment` (target element, goal
metric, status), `Variant` (content override, weight), `Assignment` (visitor→variant,
sticky), `Event` (impression/conversion, timestamp, value).

**Acceptance criteria**
- [ ] Schema reviewed for multi-tenant isolation (all queries scoped by shop)
- [ ] Indexes on high-read paths (assignment lookup, event aggregation)
- [ ] ERD or comment block documenting relationships

---

## Implement Experiment CRUD API
**Labels:** backend
**Milestone:** M1 Data & API
**Depends on:** Design schema issue

Remix loaders/actions (or GraphQL resolvers) for creating, reading, updating,
archiving experiments, scoped to the authenticated shop.

**Acceptance criteria**
- [ ] All mutations validate input and enforce shop ownership
- [ ] Status transitions restricted to valid state machine moves
- [ ] Unit tests cover create/update/invalid-transition cases

---

## Implement Variant CRUD API
**Labels:** backend
**Milestone:** M1 Data & API
**Depends on:** Experiment CRUD API

CRUD for variants nested under an experiment, including weight validation
(weights across variants sum to 100%).

**Acceptance criteria**
- [ ] Rejects variant sets that don't sum to 100%
- [ ] At least one control variant required per experiment
- [ ] Unit tests for weight validation edge cases

---

## Build experiment status state machine
**Labels:** backend
**Milestone:** M1 Data & API

Enforce valid transitions: draft → running → paused → completed (and running → completed).
Prevent editing variants once an experiment is running.

**Acceptance criteria**
- [ ] Invalid transitions rejected with clear error
- [ ] Variant edits blocked on non-draft experiments
- [ ] Tests cover every legal and illegal transition

---

## Build experiments list page
**Labels:** frontend
**Milestone:** M2 Admin UI

Polaris `IndexTable` listing experiments with status badge, target element, start date,
and quick actions (pause/resume).

**Acceptance criteria**
- [ ] Empty state for zero experiments
- [ ] Status badges match state machine values
- [ ] Loads via Remix loader, no client waterfall

---

## Build create/edit experiment flow
**Labels:** frontend
**Milestone:** M2 Admin UI
**Depends on:** Experiment CRUD API

Form to name the experiment, pick a target element type, set a goal metric
(add-to-cart, purchase), and proceed to variant setup.

**Acceptance criteria**
- [ ] Client + server-side validation match
- [ ] Draft autosave or explicit save state is clear to the merchant
- [ ] Keyboard-accessible, passes Polaris a11y patterns

---

## Build variant editor
**Labels:** frontend
**Milestone:** M2 Admin UI
**Depends on:** Variant CRUD API

Per-variant form for content overrides depending on target type (e.g. CTA text/color,
price display copy, banner image + link).

**Acceptance criteria**
- [ ] Live preview of variant content where feasible
- [ ] Weight sliders/inputs enforce 100% total in the UI before save
- [ ] Supports at least: text override, image override, CTA override

---

## Integrate product/page resource picker
**Labels:** frontend
**Milestone:** M2 Admin UI

Use App Bridge's resource picker so merchants select which product(s) or page an
experiment targets, instead of typing IDs/URLs.

**Acceptance criteria**
- [ ] Picker returns product GID stored on the experiment
- [ ] Handles multi-product selection if experiment targets a collection

---

## Add start/pause/stop experiment controls
**Labels:** frontend, backend
**Milestone:** M2 Admin UI
**Depends on:** Build experiment status state machine

Buttons on the experiment detail page wired to the state machine API, with a
confirmation step before stopping (since stopping is often irreversible for data collection).

**Acceptance criteria**
- [ ] Confirmation modal before "stop"
- [ ] UI reflects new status immediately after action
- [ ] Errors surface as Polaris toast, not silent failure

---

## Build Theme App Extension (App Block) for target sections
**Labels:** storefront
**Milestone:** M3 Storefront Delivery

Create the theme app extension with app blocks for the initial target surfaces:
product page CTA/price area and a generic banner block.

**Acceptance criteria**
- [ ] Block installs into Dawn theme via theme editor without errors
- [ ] Renders default (control) content when no experiment is active
- [ ] Documented merchant setup steps (add block to theme)

---

## Build App Proxy endpoint for experiment config
**Labels:** storefront, backend
**Milestone:** M3 Storefront Delivery
**Depends on:** Experiment CRUD API

Public (proxied) endpoint returning the active experiment + variant weights for a
given page/product, callable from the storefront without exposing Admin API auth.

**Acceptance criteria**
- [ ] Only returns data for `running` experiments
- [ ] Response cacheable at the edge for a short TTL
- [ ] No PII or shop-internal data leaked in the response

---

## Build client-side variant loader script
**Labels:** storefront
**Milestone:** M3 Storefront Delivery
**Depends on:** Build App Proxy endpoint for experiment config

JS injected via the theme app extension that fetches the active config, applies the
assigned variant's DOM changes, and fires the impression event.

**Acceptance criteria**
- [ ] No visible flash of control content before variant applies (or documented mitigation)
- [ ] Fails gracefully (shows control) if the proxy request errors or times out
- [ ] Script size and execution kept minimal (perf budget documented)

---

## Implement deterministic visitor bucketing
**Labels:** storefront, backend
**Milestone:** M4 Bucketing & Tracking
**Depends on:** Build client-side variant loader script

Hash a visitor identifier (cookie-based ID) against variant weights to assign a
variant, and persist the assignment so repeat visits are sticky.

**Acceptance criteria**
- [ ] Same visitor always gets the same variant for a given experiment
- [ ] Distribution matches configured weights within statistical tolerance (tested)
- [ ] Works without third-party cookies (first-party only)

---

## Implement impression tracking
**Labels:** storefront, backend
**Milestone:** M4 Bucketing & Tracking

Record an event when a variant is actually shown to a visitor.

**Acceptance criteria**
- [ ] One impression recorded per page view per experiment, not per DOM mutation
- [ ] Event includes experiment id, variant id, timestamp, shop id

---

## Implement add-to-cart conversion tracking
**Labels:** storefront, backend
**Milestone:** M4 Bucketing & Tracking

Hook the Ajax Cart API (or cart form submit) to record a conversion event tied to
the visitor's current assignment.

**Acceptance criteria**
- [ ] Fires only when the goal metric is add-to-cart
- [ ] Correctly attributes to the assignment even if cart change happens on a different page

---

## Implement purchase conversion tracking via webhooks
**Labels:** backend
**Milestone:** M4 Bucketing & Tracking

Subscribe to `orders/create` / `orders/paid` webhooks, match the order back to a
visitor assignment (via a stored cart/session token), and record a purchase event
with order value.

**Acceptance criteria**
- [ ] Webhook signature verified (HMAC)
- [ ] Handles orders with no matching assignment gracefully (no crash)
- [ ] Idempotent on webhook retries (no duplicate events)

---

## Add event ingestion validation & rate limiting
**Labels:** backend, compliance
**Milestone:** M4 Bucketing & Tracking

Protect the public event endpoint from abuse/spam since it's reachable from any
storefront visitor.

**Acceptance criteria**
- [ ] Rejects malformed payloads
- [ ] Rate limit per IP/visitor id
- [ ] Load-tested against a spike scenario

---

## Build results aggregation (conversion rate, revenue/visitor)
**Labels:** backend, data
**Milestone:** M5 Results & Stats
**Depends on:** Implement purchase conversion tracking via webhooks

Aggregate raw events per variant into conversion rate and revenue-per-visitor metrics,
computed on read or via a scheduled rollup job.

**Acceptance criteria**
- [ ] Numbers match manual spot-check against raw event data
- [ ] Aggregation performant at expected event volume (documented threshold)

---

## Implement statistical significance calculation
**Labels:** backend, data
**Milestone:** M5 Results & Stats

Two-proportion z-test (or sequential testing method) comparing each variant against
control, with a minimum sample size guardrail before declaring significance.

**Acceptance criteria**
- [ ] Matches a reference implementation/known test vectors
- [ ] Refuses to declare a winner below the minimum sample threshold
- [ ] Unit tests cover edge cases (zero conversions, tiny samples)

---

## Build results dashboard UI
**Labels:** frontend
**Milestone:** M5 Results & Stats
**Depends on:** Build results aggregation, Implement statistical significance calculation

Polaris page showing per-variant conversion rate, revenue/visitor, confidence
level, and a "declare winner" action.

**Acceptance criteria**
- [ ] Clearly communicates "not yet significant" vs "winner found"
- [ ] Chart renders correctly with 2+ variants
- [ ] CSV export of underlying numbers

---

## Define pricing tiers and integrate Shopify Billing API
**Labels:** billing, backend
**Milestone:** M6 Billing

Set up subscription plans (e.g. free/starter/growth by experiment count or traffic
volume) using the Billing API.

**Acceptance criteria**
- [ ] Merchant can subscribe/upgrade/downgrade from within the app
- [ ] Plan limits enforced server-side, not just in the UI
- [ ] Test charges verified in a dev store before going live

---

## Implement mandatory GDPR webhooks
**Labels:** compliance, backend
**Milestone:** M7 Compliance

`customers/data_request`, `customers/redact`, `shop/redact` handlers per Shopify's
app requirements.

**Acceptance criteria**
- [ ] All three webhooks registered and respond within Shopify's timeout
- [ ] `shop/redact` actually purges shop data from the database
- [ ] Covered by integration tests

---

## Implement app/uninstalled cleanup
**Labels:** compliance, backend
**Milestone:** M7 Compliance

On uninstall, mark the shop inactive and schedule/execute data cleanup per
retention policy.

**Acceptance criteria**
- [ ] Uninstall stops all running experiments for that shop
- [ ] No orphaned scheduled jobs continue running post-uninstall

---

## Security review: embedded app auth & App Proxy
**Labels:** compliance, backend
**Milestone:** M7 Compliance

Audit session token handling, OAuth flow, and the public App Proxy endpoint for
injection, auth bypass, and data leakage risks.

**Acceptance criteria**
- [ ] No shop data accessible without valid session token on admin routes
- [ ] App Proxy endpoint verified to only leak intended public data
- [ ] Findings documented and fixed or ticketed

---

## Write unit tests for bucketing, allocation, and stats
**Labels:** testing
**Milestone:** M8 QA

**Acceptance criteria**
- [ ] Bucketing determinism test (same input → same variant)
- [ ] Weight distribution test across large sample
- [ ] Stats engine test vectors match known-correct results

---

## Write E2E test: create experiment → storefront → event recorded
**Labels:** testing
**Milestone:** M8 QA

Full-path test: merchant creates an experiment in admin, a simulated visitor hits
the storefront, gets bucketed, triggers a conversion, and it shows up in results.

**Acceptance criteria**
- [ ] Runs in CI against a test store or mocked Shopify APIs
- [ ] Fails loudly if any link in the chain breaks

---

## Manual QA across popular free themes
**Labels:** testing
**Milestone:** M8 QA

Verify the theme app extension renders correctly on Dawn and 2 other popular free
themes, checking for layout shift and style conflicts.

**Acceptance criteria**
- [ ] Checklist of tested themes with pass/fail notes
- [ ] Any theme-specific CSS conflicts documented with workarounds

---

## Prepare App Store listing (copy, screenshots, demo video)
**Labels:** launch
**Milestone:** M9 Launch

**Acceptance criteria**
- [ ] Listing copy reviewed against Shopify's content guidelines
- [ ] Screenshots reflect current UI (not stale mockups)

---

## Submit app for Shopify review
**Labels:** launch
**Milestone:** M9 Launch
**Depends on:** all M1–M8 issues

**Acceptance criteria**
- [ ] Passes Shopify's automated + manual review checklist
- [ ] Review feedback addressed and resubmitted if needed

---

## Bugs found during Milestone 4 live testing

Found and worked through while verifying the purchase-tracking path end to
end on a real dev store (`shopsplit-z1lscgsw.myshopify.com`). Four are
resolved; one is still open.

---

### [RESOLVED] Webhook subscriptions never registered for `app dev` sessions
**Labels:** bug, backend
**Milestone:** M4 Bucketing & Tracking

Declaring webhooks in `shopify.app.toml`'s `[[webhooks.subscriptions]]` was
not enough on its own to register them with Shopify for `shopify app dev`
sessions. Verified via the Admin API (`webhookSubscriptions` query) that
zero subscriptions existed on the dev store despite three being declared
in the toml. Net effect: the `orders/paid` webhook silently never fired,
so no `PURCHASE` events were ever recorded, with no error anywhere to
point at the cause.

**Fix:** Added an explicit `webhooks` config plus an `afterAuth` hook to
`app/shopify.server.ts` that calls `shopify.registerWebhooks({ session })`
on every OAuth completion. This registers subscriptions immediately on
install/reinstall, regardless of whether `app dev` or `app deploy` is
being used.

---

### [RESOLVED] Stale local session not detected after app uninstall/reinstall
**Labels:** bug, backend
**Milestone:** M4 Bucketing & Tracking

While fixing the webhook issue above, we uninstalled and reinstalled the
app to force a fresh OAuth cycle. The app kept silently using the old,
now-revoked access token afterward — `session.isActive()` only checks the
locally cached expiry timestamp, not whether Shopify has since revoked
the token server-side. Since the stale row still looked "unexpired"
locally, `authenticate.admin()` never re-ran the token-exchange flow, so
no new session was ever persisted and `afterAuth` never fired, even after
a genuine reinstall.

**Fix:** No code change — this is inherent behavior of the session-storage
library, not a bug in our app. Deleted the stale `Session` row directly
from the database, which forced a fresh token exchange on the next
request. Documented here as a known gotcha for future dev-store reinstalls:
if webhook registration or Admin API calls seem stuck after a reinstall,
delete the local `Session` row for that shop.

---

### [RESOLVED] Theme app block disappears from a page after app reinstall
**Labels:** bug, storefront
**Milestone:** M4 Bucketing & Tracking

The "ShopSplit: Product CTA" block silently vanished from the product
page's block list after uninstalling and reinstalling the app, costing
significant debugging time before we realized the block itself was
missing (rather than a script/config bug).

**Fix:** No code change -- this is expected Shopify platform behavior:
app blocks are tied to the app being installed and get automatically
removed from theme sections on uninstall. Re-added the block via the
theme editor. Documented here so it's immediately recognizable next time.

---

### [RESOLVED] Add-to-cart detection missed some add-to-cart flows
**Labels:** bug, storefront
**Milestone:** M4 Bucketing & Tracking

The original loader script only patched `window.fetch` to detect
`/cart/add` calls. A live test purchase completed with zero cart tagging
and no `ADD_TO_CART`/`PURCHASE` events. Root-caused via direct DevTools
Network-tab inspection (confirmed the `/cart/update.js` payload had the
correct `shopsplit_<experimentId>: "<variantId>:<visitorId>"` shape once
detection actually fired).

**Fix:** Added a second, independent detector
(`installFormAddToCartDetector`) listening for native `submit` events on
forms posting to `/cart/add`, alongside the existing fetch-patch, so
add-to-cart is caught regardless of which mechanism the theme/button uses.

---

### [RESOLVED] "Buy it now" checkout isn't tracked
**Labels:** bug, storefront
**Milestone:** M4 Bucketing & Tracking

Clicking **"Buy it now"** (Shopify's dynamic checkout button) bypassed
both add-to-cart detectors, since it uses a direct-to-checkout path that
never calls `/cart/add`. Purchases made this way weren't tagged with the
experiment/variant/visitor attribute, so the `orders/paid` webhook had
nothing to attribute them to -- these conversions were invisible to
results.

**First fix attempt (partial):** moved `tagCartForPurchaseAttribution` to
fire immediately at impression time instead of waiting for an
add-to-cart signal, on the theory that a cart attribute would survive
regardless of checkout path. Verified via DevTools that the cart *was*
tagged correctly before checkout -- but a live "Buy it now" test order
still landed with zero note attributes. Root cause: Shopify's dynamic
checkout buttons don't use the regular cart at all -- they construct an
entirely separate, standalone checkout session scoped to just that one
item, so nothing tagged on the persistent cart is ever visible to them.
Tagging the cart earlier couldn't fix a checkout path that never reads
the cart in the first place.

**Actual fix:** hide dynamic checkout buttons (`.shopify-payment-button`,
the container Shopify's own script renders "Buy it now"/Shop Pay/etc.
into on virtually every theme) whenever a PURCHASE-goal experiment is
active, forcing visitors through the trackable Add to cart -> Checkout
path instead. The impression-time cart tagging is kept, since it's still
correct and covers checkout paths that *do* read the cart (including
add-to-cart flows we don't have explicit detectors for). ADD_TO_CART-goal
experiments are unaffected by either change.

---

## Production readiness

Gaps that are fine for local dev-store testing but would be genuinely
risky or broken for real merchants and real traffic. Distinct from the
billing/compliance/QA work already scoped in Milestones 6-9 -- these are
the operational/infrastructure items that surfaced from actually running
this app, not from initial planning.

---

### Migrate the database from SQLite to Postgres
**Labels:** backend, production-readiness

The dev datasource is SQLite (`prisma/schema.prisma`), which was the
right call for zero-setup local development but doesn't hold up for a
real multi-tenant production deployment: no concurrent-write safety
under real load, no managed backups, and it lives on a single instance's
disk (incompatible with any horizontally-scaled or ephemeral-filesystem
host).

**Acceptance criteria**
- [ ] `datasource db` provider switched to `postgresql`, URL from
      `env("DATABASE_URL")`
- [ ] Migrations regenerated/verified against a real Postgres instance
- [ ] Connection pooling configured appropriately for the target host
      (e.g. PgBouncer or the host's built-in pooler)
- [ ] `Assignment`/`Event` write-heavy paths spot-checked for lock
      contention under concurrent load

---

### Replace the in-memory rate limiter with a shared store
**Labels:** backend, production-readiness

`app/utils/rate-limit.server.ts` is a fixed-window limiter backed by a
plain in-process `Map`, called out at the time as a deliberate MVP
tradeoff. It only rate-limits per server instance -- useless the moment
the app runs on more than one instance (any real production deployment
for redundancy/scaling), since each instance has its own independent
counters.

**Acceptance criteria**
- [ ] Rate limiting backed by a shared store (Redis, or the host's
      equivalent) so limits hold across all running instances
- [ ] Existing behavior (429 on limit, per shop+visitor key) preserved
- [ ] Load-tested with multiple instances running concurrently

---

### Add anti-flicker handling to the storefront loader
**Labels:** storefront, production-readiness

`shopsplit-loader.js` swaps variant content in *after* the page renders
the block's default/control text, so every visitor briefly sees the
control before (possibly) seeing their assigned variant -- a "flash of
original content" that's a known weak point relative to production A/B
testing tools, which typically hide the element until the variant is
decided.

**Acceptance criteria**
- [ ] Block is hidden (e.g. `visibility: hidden` or similar) until the
      loader script has either applied a variant or confirmed no
      experiment is active
- [ ] Hide/reveal has a hard timeout fallback so a slow/failed request
      never leaves the block permanently hidden
- [ ] Perceived flicker measured before/after on a real theme

---

### Wire up event retention cleanup to a real scheduler
**Labels:** backend, production-readiness

`npm run cleanup-events -- --days N` exists and works, but nothing calls
it automatically -- there's no in-app job runner, and it was only ever
run manually during development.

**Acceptance criteria**
- [ ] Scheduled externally (host's cron/scheduled-task feature, e.g.
      Heroku Scheduler, Fly Machines cron, GitHub Actions on a schedule)
      to run on a sane cadence (e.g. daily)
- [ ] Retention window documented and configurable via env var, not a
      hardcoded flag
- [ ] Failure of a scheduled run is visible (alerting, or at minimum
      logged somewhere checked)

---

### Add structured error monitoring
**Labels:** backend, production-readiness

Right now, errors (including the ones we manually diagnosed by grepping
`shopify app dev`'s terminal output this session) only go to
`console.log`/`console.error`, which disappears once the app isn't
running in a foreground dev terminal. In production there's no dev
terminal to read.

**Acceptance criteria**
- [ ] Error tracking service integrated (e.g. Sentry) for both the web
      process and webhook handlers
- [ ] Webhook processing failures (e.g. `recordEvent` throwing inside
      `webhooks.orders.paid.tsx`) are captured, not just logged and
      swallowed
- [ ] Alerting on elevated error rate, not just individual errors

---

### Harden production deployment configuration
**Labels:** setup, production-readiness

The app currently runs against a `trycloudflare.com` tunnel that changes
on every `shopify app dev` restart, with `application_url` in
`shopify.app.toml` left as a placeholder. None of this is viable for a
real install.

**Acceptance criteria**
- [ ] App deployed to a real host with a stable domain and HTTPS
- [ ] `shopify.app.toml` `application_url`/`auth.redirect_urls`/
      `app_proxy.url` updated to the stable production domain and
      deployed via `shopify app deploy`
- [ ] Production secrets (`SHOPIFY_API_SECRET`, `DATABASE_URL`, etc.)
      managed via the host's secret store, never committed
- [ ] `SHOPIFY_APP_URL` and friends verified correct in the deployed
      environment (not just locally)

---

### Multi-tenant shop-scoping audit
**Labels:** backend, security, production-readiness

Every model query in this app is written to be scoped by `shopId`, but
that's been enforced by convention (each function takes a `shopId` and
filters by it), not by any structural guarantee. One missed `where`
clause in a future change would leak one merchant's experiment data to
another -- a serious issue for a multi-tenant app.

**Acceptance criteria**
- [ ] Audit every Prisma query in `app/models/*.server.ts` and
      `app/routes/*.tsx` for shop-scoping
- [ ] Add a regression test that asserts cross-shop access is impossible
      (e.g. shop A cannot read/mutate shop B's experiment by ID)
- [ ] Consider a lint rule or code-review checklist item to prevent
      regressions here specifically

---

### Handle offline-token refresh failures explicitly
**Labels:** backend, production-readiness

This session hit a real case where the locally stored session looked
valid (`isActive()` returned true) but was actually revoked
server-side, and the failure mode was silent -- no error, just nothing
happening (no webhook registration, no visible symptom until we dug in
manually). `future: { expiringOfflineAccessTokens: true }` means this
app relies on token refresh working correctly in production; there's
currently no handling for what happens when it doesn't.

**Acceptance criteria**
- [ ] Understand and document the token refresh failure modes for
      expiring offline access tokens in production (not a dev-store
      reinstall scenario)
- [ ] Failed refreshes are logged/alerted, not silently swallowed
- [ ] A merchant whose token is irrecoverably invalid gets a clear
      path back to a working state (re-auth prompt), not a silently
      broken app

---

## Bulk-create these issues with gh CLI

Once this project has a GitHub remote, you can turn each `##` section above into
an issue with a short script, e.g.:

```bash
gh issue create \
  --title "Scaffold app with Shopify CLI (Remix template)" \
  --label "setup,backend" \
  --milestone "M0 Setup" \
  --body "Initialize the app using \`shopify app init\`... (paste full body)"
```

For a fully scripted import, split this file into one `.md` body per issue and
loop `gh issue create --body-file`. Ask me to write that script once the repo
and milestones/labels exist on GitHub.

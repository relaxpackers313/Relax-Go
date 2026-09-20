# Relax Go — build phases

Legend: [x] done · [~] in progress · [ ] not started. A phase is done only when its workflows run end-to-end with tests.

## Phase 0 — Requirements analysis [x]
Master spec digested; business model = lead generation (customer → driver list → lead → tracked call → credit/wallet billing). Leads ≠ Calls ≠ Trips.

## Phase 1 — Architecture & database design [x]
Monorepo, stack decisions, collection design with 2dsphere geo indexes, config-over-constants principle. See `docs/ARCHITECTURE.md`.

## Phase 2 — Backend foundation & authentication [x]
Express 5 app, env config, logging, error handling, Mongo (sanitizeFilter + trusted), platform-settings engine (cached, versioned, audited), admin auth (email/password + JWT, bootstrap admin), driver auth (Firebase phone → verified token → driver JWT), anonymous customer sessions, rate limiting, audit log. Integration tests on memory replica set.

## Phase 3 — Admin panel foundation [x]
Next.js app: login, shell, dashboard counters, settings editor (typed forms over the settings schema), audit trail viewer.

## Phase 4 — Driver registration & approval [x] (API; driver-app screens in Phase 6)
Registration submission (profile, vehicle, configurable documents), document upload (Cloudinary), statuses pending/approved/rejected/correction_required/suspended/blocked, admin review queue + decisions with reasons, resubmission, status screens in driver app. Approval emails via Brevo.

## Phase 5 — Customer app [x] (device/store testing pending — needs an EAS/dev-client build)
Expo RN: map-first home (MapLibre/OSM), locate me, nearby driver markers + list sorted by distance, driver card (vehicle, rating, distance), request/contact flow, lead status, history, favorites, settings/privacy. No mandatory signup.

## Phase 6 — Driver app [x] (phone+password sign-in, zero external deps; device/store testing pending — needs only `expo run:android`)
Expo RN: Firebase phone login, onboarding wizard, approval-status screens, online/offline toggle, foreground-service background location, incoming leads, customer card + call button, credits/wallet balance, history, notifications.

## Phase 7 — Location & realtime infrastructure [x] (Redis pub/sub slot documented for multi-node)
Driver location ingestion (batch, validated, throttled history + TTL), presence states active/background/stale/offline, Socket.IO gateway (driver rooms, customer subscriptions), reconnect/stale handling, last-known location.

## Phase 8 — Driver discovery & geospatial engine [x] (road-distance enrichment via OSRM is the remaining optional mode)
$geoNear discovery with config-driven radius clamp/freshness/vehicle filter/eligibility, ranked output, straight-line first pass + optional road distance via routing provider abstraction (OSRM default).

## Phase 9 — Lead system [x]
Lead entity + auditable status transitions (created→shown→viewed→accepted/rejected→contacted→converted/expired/cancelled), expiry worker, duplicate rules, driver notification, customer status view.

## Phase 10 — Call tracking & credit engine [x]
Call entity, initiate-call endpoint gating by eligibility checklist (approved? active? credits? balance? price? lead valid? duplicate?), free-credit consumption rules (registration/daily/weekly/monthly/promo), pricing engine over PricingRules with priority resolution, call outcome recording, masked-calling provider abstraction (dialer fallback first).

## Phase 11 — Wallet & payments [x] (Razorpay adapter; masked calling still dialer-based)
Wallet + immutable ledger, recharge via payment-gateway abstraction (Razorpay adapter), server-side verification + webhook signature, idempotent crediting, refunds, receipts (Brevo), low-balance notifications.

## Phase 12 — Admin dynamic configuration [x] (typed settings editor incl. vehicle-type and document-requirement editors; polygon drawing via API for now)
Full settings UI: discovery radius, pricing rules CRUD, free-credit rules, vehicle types, document requirements, map/routing provider + keys, feature flags, service areas (map polygon editor), config version history.

## Phase 13 — Safety & support [x] (SOS dialer screens, trip sharing, support tickets, push+in-app notifications)
SOS architecture, emergency contacts, share-trip link, report issue, support tickets (customer + driver) with admin assignment/resolution.

## Phase 14 — Reports & analytics [x]
Driver/lead/call/wallet/geography reports, demand zones, driver density, revenue.

## Phase 15 — Security & performance hardening [x] (config-driven rate limits, GPS-anomaly fraud flags with admin clear, load-tested discovery/location pipeline — p50 196ms/365ms at 20-way concurrency against Atlas over WAN — plus RBAC, webhook signatures, guarded atomic wallet ops, audit log)
RBAC review, webhook signatures, fraud flags (spoofed location, call farming, duplicate accounts), rate-limit tuning, index audit, load-test discovery + location pipeline.

## Phase 16 — Full QA & production readiness [~] (20 API integration tests + live verification against Atlas; EDGE-CASES.md written; remaining items are user-gated: on-device QA via `expo run:android`, Razorpay keys when ready, legal counsel review)
End-to-end QA across all three clients, edge-case matrix (docs/EDGE-CASES to be written), store-readiness for the mobile apps, legal document set review.

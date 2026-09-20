# Relax Go — architecture

## System overview

```
Customer app (Expo RN)        Driver app (Expo RN)          Admin panel (Next.js)
   │  REST + Socket.IO           │  REST + Socket.IO            │  REST
   └──────────────┬──────────────┴──────────────┬───────────────┘
                  ▼                             ▼
            apps/api — Express 5 + TypeScript (:4100)
   auth · settings · drivers · discovery · locations · leads · calls
   wallet · pricing · notifications · support · admin · audit
                  │                          │
        MongoDB Atlas (2dsphere)      Socket.IO gateway
        current locations, ledger,    driver presence rooms,
        leads/calls, settings         customer map subscriptions
```

External providers, all behind abstractions: Firebase (driver phone auth), map/tiles (OSM/MapLibre default), geocoding (Nominatim default), routing (OSRM default), payments (Razorpay adapter first), email (Brevo), file storage (Cloudinary), push (FCM via Expo).

## Key decisions

1. **Mobile stack: React Native + Expo (dev-client builds).** Real native capability where it matters — Android foreground service for background GPS (`expo-location` + `expo-task-manager`), FCM push, camera/document capture, secure storage, deep links — with one TypeScript codebase coherent with the rest of the monorepo. Not a WebView.
2. **Lead-first domain model.** `Lead` (customer expressed demand toward a driver), `Call` (a tracked, billable contact attempt), `Trip` (optional operational lifecycle) are separate collections with their own auditable status history. Revenue attaches to Calls, not Trips.
3. **Config engine is the backbone.** One versioned `PlatformSettings` document validated by the shared zod schema (`packages/shared/src/config.ts`) which also defines every default (50 km max radius, free credits, prices in paise, providers, feature flags…). API code reads config through a cached service; admin edits produce an audited version bump. Business logic never hardcodes these values.
4. **Location pipeline built for volume.** Driver apps batch GPS points → `POST /driver/locations` validates sanity (bounds, accuracy, speed) → single upsert into `driverlocations` (the live store, 2dsphere) → sampled insert into `locationhistory` (TTL). Presence state machine: `active` (fresh foreground) / `background` / `stale` (older than config freshness) / `offline` (toggled off or disconnected). Realtime fan-out over Socket.IO with server timestamps; customers get throttled updates for drivers in their viewport, never a raw firehose. Redis can slot in later for multi-node presence without model changes.
5. **Discovery = `$geoNear` + eligibility.** Query the live-location store with `maxDistance` (radius clamped by config), freshness cutoff and `online: true`, then join driver records filtered by `status: approved`, vehicle type, zone eligibility, block flags. Ranked by configured sort (distance default). Straight-line for the list; road distance/ETA via the routing abstraction when config demands it.
6. **Money and credits.** Integer paise everywhere. `Wallet` is a cached view; `WalletTransaction` is the truth (kind: recharge, call_charge, refund, adjustment, free/promo grant & consume; balanceAfter snapshots; idempotency keys). All mutations inside MongoDB transactions. Payment crediting only after server-verified gateway confirmation (order → signature/webhook → transaction), never from the client.
7. **Call eligibility & pricing.** Before a chargeable contact: approved → active → lead valid → duplicate/cooldown rules → free credits (consumed by configured priority: promo → daily free → registration grant) → else wallet balance vs. resolved price. Price resolution: highest-priority active `PricingRule` matching vehicle type/city/zone/driver category/time window, falling back to the config base price. The driver always sees the applicable charge before calling.
8. **Auth.** Drivers: phone + password by default (scrypt; resets via audited admin action) — Firebase Phone Auth stays as a config-switchable mode with server-side ID-token verification. Customers: anonymous `CustomerSession` + JWT (kind `customer`), optional phone OTP only when an operation needs it; accounts attachable later. Admins: email + scrypt password, JWT, RBAC permissions from the shared catalog (including granular location-viewing permissions).
9. **Privacy.** Customer numbers are not handed to drivers by default — call initiation returns a callable reference; masked/relay calling integrates later behind a `CallProvider` abstraction with plain-dialer fallback. Location retention, history TTL and admin visibility are config- and permission-controlled.
10. **Ports.** API :4100, admin :3100 (PharmaOS occupies :4000/:3000 on this machine).

## Collections
adminusers, customersessions, drivers, driverdocuments, vehicles, driverlocations (live, 2dsphere), locationhistory (TTL, 2dsphere), leads, calls, trips, wallets, wallettransactions, payments, pricingrules, serviceareas (2dsphere polygons), notifications, supporttickets, ratings, auditlogs, platformsettings.

Indexes of note: `driverlocations {location: 2dsphere} + {driverId unique}`; `leads {driverId, status}, {customerSessionId, createdAt}, {expiresAt TTL-checked by worker}`; `wallettransactions {walletId, createdAt}, {idempotencyKey unique sparse}`; `serviceareas {polygon: 2dsphere}`.

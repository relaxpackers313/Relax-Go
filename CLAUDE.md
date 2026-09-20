# Relax Go — working notes for AI assistants and new contributors

## What this is
Relax Go is a ride-discovery, driver-lead and mobility platform: a **ChefoTech product operated/managed by Relax Group**. The business model is lead generation, not automatic ride assignment: customer sees a list of real nearby drivers sorted by distance → picks one → a Lead is created → the driver calls the customer → the call consumes a free credit or is charged from the driver's wallet. Leads, Calls and Trips are separate entities.

Three systems in a pnpm monorepo:
- `apps/api` — Node.js + TypeScript backend (Express 5 + Mongoose 9 + zod 4 + Socket.IO), port 4100.
- Driver auth default is PHONE + PASSWORD (`auth.driverAuthMode: 'phone_password'`): no Firebase/SMS dependency; password resets are an audited admin action. Firebase phone-OTP remains a config-switchable mode (server verification stays wired; the driver app needs @react-native-firebase reinstalled + google-services.json for it). Password-mode drivers carry a synthetic `firebaseUid: pw:<phone>` to satisfy the unique index.
- `apps/admin` — Next.js web admin/operations panel, port 3100.
- `apps/customer`, `apps/driver` — React Native (Expo dev-client) native apps. NOT WebView wrappers.
- `packages/shared` — zod schemas, the platform-settings schema with all defaults, constants, money utils, permission catalog.

Roadmap and current status: `docs/PHASES.md`. Architecture decisions: `docs/ARCHITECTURE.md`.

## Commands
- `pnpm --filter @relaxgo/shared build` — required once before api/admin (they import the built package).
- `pnpm dev:api` / `pnpm dev:admin` — dev servers on :4100 / :3100 (`.claude/launch.json` has both).
- `pnpm test` — vitest; api integration tests use mongodb-memory-server (replica set; data dir under `node_modules/.cache/mongodb-memory-server/data` because the system C: drive is full — override with `RELAXGO_TEST_DBPATH`).
- `pnpm typecheck`, `pnpm build`.

## Non-negotiable rules
1. **Money = integer paise.** Wallet balances, call prices, recharges — all integer minor units. Helpers in `packages/shared/src/money.ts`.
2. **Every credit/balance change goes through the ledger.** Never update a wallet balance without creating a `WalletTransaction` in the same MongoDB transaction. Balances can be recomputed from the ledger. Wallets never go negative unless config explicitly allows credit.
3. **Configuration over constants.** Radius, free credits, call prices, lead expiry, map/routing provider, vehicle types, document requirements, feature flags — ALL come from `PlatformSettings` (schema + defaults in `packages/shared/src/config.ts`, served by `modules/settings`). If a business number appears as a literal in service code, that's a bug. Config changes are audited with old/new value, actor and version.
4. **Server-side truth.** Never trust the mobile client for wallet balance, call price, free credits, approval status, payment success or location eligibility. Payment credits happen only after server-side gateway verification (webhook/signature), never from a client "success" response.
5. **Geospatial discipline.** Driver discovery uses `$geoNear` on the `driverlocations` 2dsphere index — never scan all drivers. Every discovery result respects: radius clamp from config, driver `status=approved`, `online=true`, location freshness threshold. Reject invalid GPS points (out-of-range, absurd accuracy/speed). Current location is one upsert per driver; history is sampled/throttled with TTL, never one row per GPS tick.
6. **Driver approval gates everything operational.** A driver who is not `approved` can authenticate and see their status/resubmit documents — nothing else. States: pending, approved, rejected, correction_required, suspended, blocked (+ online/offline presence, which is separate from status).
7. **Audit sensitive actions** (approval, rejection, suspension, wallet/credit adjustments, pricing/config changes, refunds, blocks): actor, action, target, before, after, reason, timestamp — via `lib/audit.ts`.
8. **Customer accounts are optional.** Customers are anonymous `CustomerSession`s (device/session identity, optional phone verification only where an operation truly needs it). Never make signup a blocker. Architect so real accounts can attach to sessions later.
9. **No fake UI, no fake claims.** Screens are backed by real APIs; unfinished work lives in `docs/PHASES.md`. Don't claim emergency-service or telecom integrations that aren't implemented.
10. Rate-limit OTP, auth, lead creation, call initiation, wallet ops and location updates. `sanitizeFilter` is global; wrap server-built Mongo operators with `trusted()` from `lib/mongo.ts`.

## Brand & company facts (do not invent others)
- Product **Relax Go**; parent technology org **ChefoTech**; operator **Relax Group** (source: https://packers.relaxgroup.in — "A unit of Relax Group", est. 2010, ISO 9001:2015, GSTIN 21BUQPN8897R1Z8).
- Relax Group head office: Khata No. 313/143, Plot No. 945/1260, Tangarhuda, Satinagar, PO Markat Nagar, PS Bidanasi, Cuttack, Odisha 753014. Phones +91 97770 12315 / +91 96920 12315; email bookrelaxpackers@gmail.com; branches: Cuttack (HO), Bhubaneswar, Dhenkanal, Angul, Balasore, Balangir, Koraput, Jagdalpur.
- These live as defaults in the `brand` section of the platform settings; admin can override them. Never hard-code them elsewhere.
- Original Relax Go visual identity: UX may feel familiar (map-first, driver list, live tracking) but never copy Rapido/Uber/Ola logos, artwork, copy or pixel-level design.

## Environment
`apps/api/.env` (git-ignored) holds the Atlas URI (non-SRV form; local resolver refuses SRV — set `DNS_SERVERS=8.8.8.8` to use `mongodb+srv://`), JWT secrets, Firebase service account (base64), Brevo key, Cloudinary keys. `.env.example` has placeholders only. Never commit or log secrets.

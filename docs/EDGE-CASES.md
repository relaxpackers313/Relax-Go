# Relax Go — edge-case behaviour (spec §71)

How the implemented system behaves in each hard case. ✔ = covered by an automated test.

| Case | Behaviour |
|---|---|
| No nearby drivers | Discovery returns an empty list; customer app shows "No drivers available within N km" with pull-to-refresh. ✔ (radius test) |
| Only distant drivers | Radius is clamped to the admin max (default 50 km); a driver at 52 km never appears. ✔ |
| Driver goes offline | Presence flips instantly (socket `driver:presence`), driver drops from the next discovery; customer app refetches on the event. ✔ |
| Driver location goes stale | Rows older than the freshness threshold (default 120 s) are excluded from discovery even while `online=true`; admin map shows them amber as `stale`. ✔ |
| Customer changes location | Discovery is re-queried with the new coordinates (query key includes lat/lng). |
| Driver rejects lead | `rejected` is terminal; customer sees "Driver declined — pick another driver" and a shortcut to the map. ✔ (transition graph) |
| Lead expires | Expiry worker (30 s cadence) transitions overdue leads to `expired`; calls on an expired lead are refused with 409. ✔ |
| Customer cancels | `cancelled` via the app; allowed from any live status; driver list refreshes on the socket event. ✔ |
| Duplicate lead | Same session → same driver inside the duplicate window → 409 "recent request with this driver". ✔ |
| Duplicate call | Re-dial on the same lead inside the window is classification `unbilled` — never charged twice. ✔ |
| Failed call | Driver reports `no_answer`/`failed`; with charge-only-connected enabled, an unconnected call settles as `unbilled`. |
| Wallet payment pending | Payment doc stays `created/pending`; nothing is credited until gateway verification. ✔ |
| Payment succeeds but webhook is delayed | Client `verify` credits first; the late webhook is idempotent (status guard + unique ledger key) — no double credit. ✔ |
| Recharge duplicated | Same payment can only ever produce one ledger row (unique `idempotencyKey`). ✔ |
| Free credits exhausted / balance zero | 402 with the exact product message: "You have no call credits available. Add money to your wallet to continue." ✔ |
| Concurrent chargeable calls | Guarded atomic wallet update (`$gte` floor + `$inc` in one op inside a transaction) — a race cannot overspend. |
| Driver suspended during active lead | Suspension forces `online=false` in the same transaction; driver drops from discovery instantly and operational endpoints return 403. ✔ |
| Customer blocks driver / abuse | Admin blocks the customer session (with reason, audited); blocked sessions fail auth with 403. |
| Network disconnect (driver) | GPS points queue in AsyncStorage (capped at 500, newest kept) and flush in batches on recovery; socket reconnects with backoff and re-watches. |
| GPS disabled / permission revoked | Going online demands foreground permission; without background permission the driver is warned they will drop off the map when minimized; the server-side freshness cutoff turns silent drivers `stale` regardless. |
| App killed / phone restart | Android foreground service keeps tracking while online; after a kill/restart the home screen re-syncs the switch with `isTracking()`, and staleness protects customers meanwhile. |
| Location spoofing / teleports | Server rejects out-of-range, future-dated, low-accuracy and implausible-speed points (>180 km/h between fixes). ✔ |
| Low battery | Battery level rides along with location updates and is visible on the admin live map. |
| Multiple devices | A driver signing in on a new device gets a new JWT; location upserts key on driverId so the newest device wins; Firebase uid ↔ phone uniqueness prevents duplicate driver records. ✔ (conflict test path) |
| Simultaneous lead requests | Leads are independent rows; the active-lead cap per customer (default 5) bounds fan-out; per-driver duplicate window stops spam at one driver. ✔ |

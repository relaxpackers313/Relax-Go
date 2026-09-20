# Deploying Relax Go

Target topology:

| Piece | Host | URL shape |
| --- | --- | --- |
| API + realtime (`apps/api`) | Render web service | `https://relaxgo-api.onrender.com` |
| Admin panel (`apps/admin`) | Vercel | `https://relaxgo-admin.vercel.app` |
| Database | MongoDB Atlas (existing `relaxgo` db) | `mongodb+srv://…` |
| Customer / driver apps | Android builds pointing at the Render URL | — |

Everything below assumes the repo is pushed to GitHub and `main` is the deploy branch.

---

## 0. Before you deploy: rotate the secrets

Every credential that was shared in chat during development must be replaced, because the
old values should be considered public:

- **Atlas**: create a new database user, drop the old one, and update `MONGODB_URI`.
- **JWT**: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` → new `JWT_ACCESS_SECRET` (this invalidates all existing sessions, which is what you want).
- **Google Maps key**: create a *new* key, then in Google Cloud Console restrict it —
  Android apps (`in.relaxgroup.relaxgo` + `in.relaxgroup.relaxgo.driver` with their SHA-1
  fingerprints) and API restrictions to Maps SDK for Android, Places API, Routes API.
  Use the **same key** for `GOOGLE_MAPS_API_KEY` (server) only if you also allow server IPs;
  cleaner is one Android-restricted key for the apps and one IP-restricted key for Render.
- **Brevo / Cloudinary / Firebase service account**: regenerate in each console.
- **Admin bootstrap password**: pick a new strong one; it seeds the first superadmin.

No secret belongs in git. `.env` files are ignored; Render and Vercel hold the real values.

---

## 1. MongoDB Atlas

1. **Network access** → add `0.0.0.0/0`. Render's Starter plan has no static outbound IP, so
   the allow-list cannot be narrowed; the strong database password is the protection.
   (If you later move to a Render plan with static IPs, replace this with those IPs.)
2. Keep using the `relaxgo` database — all existing data, drivers and settings carry over.
3. Either URI form works on Render. The `mongodb+srv://` form is simplest; leave
   `DNS_SERVERS` empty (the local-resolver workaround is only needed on your laptop).

## 2. API on Render

1. Render → **New → Blueprint** → connect the GitHub repo. It reads `render.yaml`, which
   already sets the build (`pnpm install → build shared → build api`), the start command
   (`node apps/api/dist/server.js`), the health check (`/health`) and the Singapore region.
2. Fill in every variable marked `sync: false` in the dashboard:

   | Key | Value |
   | --- | --- |
   | `MONGODB_URI` | the rotated Atlas URI |
   | `JWT_ACCESS_SECRET` | the new 96-char random string |
   | `ADMIN_ORIGIN` | `https://relaxgo-admin.vercel.app` (comma-separate extras, no trailing slash) |
   | `VERCEL_PROJECT_NAME` | `relaxgo-admin` — optional, allows that project's preview deploys |
   | `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | seeds the first superadmin on first boot |
   | `GOOGLE_MAPS_API_KEY` | server-side key (Places + Routes) |
   | `CLOUDINARY_*` | driver-document uploads |
   | `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` | transactional email (console provider if empty) |
   | `FIREBASE_SERVICE_ACCOUNT_BASE64` | only if you switch driver auth back to OTP |
   | `RAZORPAY_*` | leave empty until the gateway is enabled in admin settings |

   On the first deploy `ADMIN_ORIGIN` is a chicken-and-egg: deploy Vercel first, or set it
   afterwards — changing it restarts the service in seconds.
3. **Do not use the Free instance type.** Free services sleep after 15 minutes and take ~50 s
   to wake; drivers streaming GPS and customers watching the map would both break. Starter
   (~$7/mo) stays awake.
4. Verify: `curl https://relaxgo-api.onrender.com/health` → `{"ok":true,"service":"relaxgo-api"}`,
   and the Render log line `relaxgo api listening`.

WebSockets (Socket.IO on `/realtime`) work on Render without extra configuration.

## 3. Admin panel on Vercel

1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory: `apps/admin`** and leave "Include files outside the root directory"
   enabled (needed for the pnpm workspace). `apps/admin/vercel.json` supplies the install and
   build commands that build `@relaxgo/shared` first.
3. Environment variable:

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://relaxgo-api.onrender.com/api/v1` |

   Set it for Production *and* Preview so preview deploys hit the same API.
4. Deploy, then sign in at `https://<your-vercel-domain>` with the bootstrap admin. If the
   browser console shows a CORS error, `ADMIN_ORIGIN` on Render does not match the domain
   exactly (scheme, no trailing slash).
5. Optional: add a custom domain (e.g. `admin.relaxgroup.in`) in Vercel, then append it to
   `ADMIN_ORIGIN` on Render.

## 4. Mobile apps → the deployed API

The apps read the backend from their git-ignored `.env` (see `.env.example`):

```
GOOGLE_MAPS_ANDROID_KEY=<android-restricted key>
RELAXGO_API_URL=https://relaxgo-api.onrender.com
```

`app.config.js` turns that into `extra.apiUrl` / `extra.socketUrl` at build time. Then:

```bash
cd apps/customer && npx expo prebuild -p android --no-install
cd android && ./gradlew :app:assembleRelease      # repeat for apps/driver
```

Leave `RELAXGO_API_URL` empty to go back to the local dev API over `adb reverse`.

Environment needed for those builds: `ANDROID_HOME=D:/Android/Sdk`,
`GRADLE_USER_HOME` outside the repo, `EXPO_NO_METRO_WORKSPACE_ROOT=1`.

Release builds must be signed with a **release keystore** before Play Store upload; the
current APKs use the debug signing key, which is fine for sideloading only.

## 5. After the first deploy

- Sign in to the admin panel and re-check **Settings** — the platform-settings document lives
  in the database, so radius, pricing, allowances and the map providers carry over from dev.
- Watch the dashboard's **Maps & server usage** card for the first days and set the Google
  Cloud budget alert + per-API daily quotas (see the billing notes in the chat history).
- The demo fleet (`scripts/seed-nearby-drivers.mjs`, `drive-demo.mjs`) is **dev tooling**.
  Never run it against production — it creates fake approved drivers.
- Backups: enable Atlas automated backups for the `relaxgo` cluster.

## 6. Known gaps before a public launch

- Razorpay is not wired (`wallet.paymentGateway` stays `none`; recharges are admin wallet
  adjustments until keys exist).
- `docs/legal/*` are drafts and need counsel review.
- Play Store submission needs the release keystore, a privacy-policy URL and store listing.

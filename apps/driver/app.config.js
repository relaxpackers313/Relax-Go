/**
 * Extends app.json with values that must never be committed and with the backend the build
 * should talk to:
 *   GOOGLE_MAPS_ANDROID_KEY — baked into AndroidManifest at prebuild (Maps SDK for Android).
 *   RELAXGO_API_URL         — e.g. https://relaxgo-api.onrender.com  (no trailing slash).
 * Both come from the app's git-ignored .env (see .env.example). Without RELAXGO_API_URL the
 * build stays on the local dev API, which is what we want on a laptop.
 */
const appJson = require('./app.json');

const base = (process.env.RELAXGO_API_URL ?? '').replace(/\/$/, '');

module.exports = ({ config }) => ({
  ...appJson.expo,
  ...config,
  android: {
    ...appJson.expo.android,
    config: {
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? '' },
    },
  },
  extra: {
    ...appJson.expo.extra,
    ...(base ? { apiUrl: `${base}/api/v1`, socketUrl: base } : {}),
  },
});

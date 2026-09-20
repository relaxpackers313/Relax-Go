// ORIGINAL Relax Go top-down vehicle sprites v2 — carefully drawn so each vehicle is
// recognisable at a glance on the map (our own artwork, rasterized from SVG).
// Usage: node scripts/make-sprites.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outs = [path.resolve(here, '../apps/customer/assets/vehicles'), path.resolve(here, '../apps/driver/assets/vehicles')];
for (const o of outs) fs.mkdirSync(o, { recursive: true });

const defs = `
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFD75E"/><stop offset="0.5" stop-color="#FFC531"/><stop offset="1" stop-color="#EFA614"/>
    </linearGradient>
    <linearGradient id="glassF" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3D4F6B"/><stop offset="1" stop-color="#1E2A3D"/>
    </linearGradient>
    <linearGradient id="roof" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#F7BE2E"/><stop offset="0.5" stop-color="#FFD75E"/><stop offset="1" stop-color="#F7BE2E"/>
    </linearGradient>
  </defs>`;

/** Top-down hatchback/taxi: shadow, tapered body, bonnet+boot, mirrors, 4 wheels, front/rear glass, roof. */
const car = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="230" viewBox="0 0 120 230">${defs}
  <ellipse cx="60" cy="118" rx="52" ry="106" fill="#000" opacity="0.14"/>
  <rect x="8"  y="42"  width="14" height="34" rx="7" fill="#161d29"/>
  <rect x="98" y="42"  width="14" height="34" rx="7" fill="#161d29"/>
  <rect x="8"  y="152" width="14" height="34" rx="7" fill="#161d29"/>
  <rect x="98" y="152" width="14" height="34" rx="7" fill="#161d29"/>
  <path d="M60 6 C92 6 104 26 105 56 L106 168 C106 202 88 216 60 216 C32 216 14 202 14 168 L15 56 C16 26 28 6 60 6 Z"
        fill="url(#body)" stroke="#B97F0C" stroke-width="3"/>
  <rect x="10" y="60" width="12" height="18" rx="5" fill="url(#body)" stroke="#B97F0C" stroke-width="2"/>
  <rect x="98" y="60" width="12" height="18" rx="5" fill="url(#body)" stroke="#B97F0C" stroke-width="2"/>
  <path d="M28 62 Q60 48 92 62 L86 92 Q60 82 34 92 Z" fill="url(#glassF)"/>
  <path d="M25 96 L34 92 L34 128 L25 124 Z" fill="#2B3A52" opacity="0.9"/>
  <path d="M95 96 L86 92 L86 128 L95 124 Z" fill="#2B3A52" opacity="0.9"/>
  <rect x="32" y="96" width="56" height="62" rx="12" fill="url(#roof)" stroke="#D99A16" stroke-width="2"/>
  <path d="M32 176 Q60 188 88 176 L84 158 Q60 168 36 158 Z" fill="url(#glassF)" opacity="0.95"/>
  <rect x="30" y="10" width="16" height="7" rx="3.5" fill="#FFF6D9" opacity="0.95"/>
  <rect x="74" y="10" width="16" height="7" rx="3.5" fill="#FFF6D9" opacity="0.95"/>
  <rect x="30" y="209" width="16" height="6" rx="3" fill="#D64541"/>
  <rect x="74" y="209" width="16" height="6" rx="3" fill="#D64541"/>
</svg>`;

/** Top-down auto-rickshaw: narrow nose, windshield, big black canopy with ribs, 3 wheels. */
const auto = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="210" viewBox="0 0 120 210">${defs}
  <ellipse cx="60" cy="108" rx="52" ry="96" fill="#000" opacity="0.14"/>
  <rect x="52" y="4"  width="16" height="30" rx="8" fill="#161d29"/>
  <rect x="8"  y="140" width="15" height="36" rx="7" fill="#161d29"/>
  <rect x="97" y="140" width="15" height="36" rx="7" fill="#161d29"/>
  <path d="M60 10 C86 10 100 34 102 68 L104 156 C104 186 86 200 60 200 C34 200 16 186 16 156 L18 68 C20 34 34 10 60 10 Z"
        fill="url(#body)" stroke="#B97F0C" stroke-width="3"/>
  <path d="M34 42 Q60 30 86 42 L81 64 Q60 55 39 64 Z" fill="url(#glassF)"/>
  <path d="M22 74 C22 70 98 70 98 74 L100 158 C100 184 84 194 60 194 C36 194 20 184 20 158 Z" fill="#232D3F" stroke="#101722" stroke-width="2"/>
  <rect x="24" y="92"  width="72" height="5" rx="2.5" fill="#3B4960"/>
  <rect x="24" y="116" width="72" height="5" rx="2.5" fill="#3B4960"/>
  <rect x="24" y="140" width="72" height="5" rx="2.5" fill="#3B4960"/>
  <rect x="24" y="164" width="72" height="5" rx="2.5" fill="#3B4960"/>
  <rect x="46" y="13" width="28" height="7" rx="3.5" fill="#FFF6D9" opacity="0.95"/>
</svg>`;

/** Top-down motorbike with rider: front wheel + fork + handlebar, tank, rider shoulders + helmet, rear wheel. */
const bike = `
<svg xmlns="http://www.w3.org/2000/svg" width="90" height="220" viewBox="0 0 90 220">${defs}
  <ellipse cx="45" cy="112" rx="34" ry="102" fill="#000" opacity="0.14"/>
  <rect x="36" y="6" width="18" height="46" rx="9" fill="#161d29"/>
  <rect x="41" y="10" width="8" height="38" rx="4" fill="#2E3B50"/>
  <rect x="42" y="48" width="6" height="26" fill="#5A6B85"/>
  <rect x="10" y="58" width="70" height="9" rx="4.5" fill="#1E2A3D"/>
  <rect x="6"  y="55" width="12" height="15" rx="6" fill="#161d29"/>
  <rect x="72" y="55" width="12" height="15" rx="6" fill="#161d29"/>
  <path d="M45 70 C58 70 62 78 62 92 L62 108 C62 118 56 124 45 124 C34 124 28 118 28 108 L28 92 C28 78 32 70 45 70 Z"
        fill="url(#body)" stroke="#B97F0C" stroke-width="3"/>
  <path d="M45 96 C64 96 72 108 72 126 L70 150 C68 166 58 172 45 172 C32 172 22 166 20 150 L18 126 C18 108 26 96 45 96 Z"
        fill="#232D3F"/>
  <path d="M20 118 C10 122 8 132 12 138 L20 134 Z" fill="#232D3F"/>
  <path d="M70 118 C80 122 82 132 78 138 L70 134 Z" fill="#232D3F"/>
  <circle cx="45" cy="120" r="21" fill="url(#body)" stroke="#B97F0C" stroke-width="3"/>
  <path d="M26 118 Q45 108 64 118" stroke="#fff" stroke-width="5" fill="none" opacity="0.85"/>
  <rect x="36" y="176" width="18" height="40" rx="9" fill="#161d29"/>
  <rect x="41" y="180" width="8" height="32" rx="4" fill="#2E3B50"/>
</svg>`;

/** Map dots (native marker images): the viewer's own position and anonymous customer demand. */
const meDot = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="26" fill="#2563EB" opacity="0.25"/>
  <circle cx="32" cy="32" r="14" fill="#2563EB" stroke="#fff" stroke-width="5"/>
</svg>`;
const demandDot = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="26" fill="#F97316" opacity="0.3"/>
  <circle cx="32" cy="32" r="13" fill="#F97316" stroke="#fff" stroke-width="5"/>
</svg>`;
const etaDot = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="16" fill="#111827" stroke="#fff" stroke-width="6"/>
</svg>`;
const pickupPin = `
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="108" viewBox="0 0 72 108">
  <rect x="33" y="48" width="6" height="46" rx="3" fill="#1F2733"/>
  <ellipse cx="36" cy="98" rx="12" ry="5" fill="#000" opacity="0.25"/>
  <circle cx="36" cy="30" r="24" fill="#17B26A" stroke="#fff" stroke-width="6"/>
  <circle cx="36" cy="30" r="8" fill="#fff"/>
</svg>`;

// Heights are 1x pixels: the react-native-maps `image` prop treats bundled assets as
// density-1, so these ARE the on-screen dp sizes. Keep them marker-sized.
for (const [name, svg, height] of [
  ['car', car, 46],
  ['auto', auto, 44],
  ['bike', bike, 42],
  ['me-dot', meDot, 30],
  ['eta-dot', etaDot, 18],
  ['demand-dot', demandDot, 22],
  ['pickup-pin', pickupPin, 44],
]) {
  const png = await sharp(Buffer.from(svg)).resize({ height }).png().toBuffer();
  for (const o of outs) fs.writeFileSync(path.join(o, `${name}.png`), png);
  console.log('sprite:', name, png.length, 'bytes');
}
console.log('done →', outs.join(' + '));

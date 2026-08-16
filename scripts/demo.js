/**
 * Creates two sample presentations without touching WhatsApp, so you can see
 * the output locally:  npm run demo  →  npm start  →  open the printed links.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { savePresentation, newId, flushNow } from '../src/store.js';
import { writeWorkbook } from '../src/excel.js';

const SAMPLE_EN = `Sea-view apartment in Marassi North Coast
Location: Marassi, Sidi Abdel Rahman
Price: 12.5M EGP
Area: 185 m²
Bedrooms: 3
Bathrooms: 3
Floor: 4
Finishing: Fully finished
Delivery: Q3 2026
Payment: 10% down payment, 8 years installments
Prime location steps from the beach club`;

const SAMPLE_AR = `شقة للبيع في كمبوند بالم هيلز
الموقع: بالم هيلز، أكتوبر
السعر: 8.4 مليون جنيه
المساحة: 165 متر
الغرف: 3
الحمامات: 2
الدور: الثاني
التشطيب: سوبر لوكس
التسليم: فوري
قريبة من النادي والمنطقة التجارية`;

function placeholder(label, from, to) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2=".7" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <text x="60" y="740" font-family="Segoe UI, sans-serif" font-size="26" letter-spacing="4"
        fill="rgba(255,255,255,.62)">${label.toUpperCase()}</text>
</svg>`;
}

const PALETTE = [
  ['#b9b2a4', '#7d7566'],
  ['#a8b0aa', '#6b7570'],
  ['#c3b6a6', '#8a7a68'],
  ['#aab3bd', '#6e7883'],
  ['#bdb0ad', '#837470'],
];

async function writePlaceholders(runId, names, { light = false } = {}) {
  const dir = path.join(config.uploadsDir, runId);
  await fsp.mkdir(dir, { recursive: true });
  const rels = [];
  for (const [i, name] of names.entries()) {
    const [from, to] = light ? ['#ffffff', '#eae7e0'] : PALETTE[i % PALETTE.length];
    const file = `${i + 1}-${name.toLowerCase().replace(/\s+/g, '-')}.svg`;
    await fsp.writeFile(path.join(dir, file), placeholder(name, from, to), 'utf8');
    rels.push(`${runId}/${file}`);
  }
  return rels;
}

async function buildDemo(text, { photos, plans, runIdPrefix }) {
  const runId = `${runIdPrefix}-${newId(3)}`;
  const images = await writePlaceholders(runId, photos);
  const floorplans = await writePlaceholders(`${runId}-plans`, plans, { light: true });

  return await savePresentation({
    id: newId(8),
    createdAt: new Date().toISOString(),
    waId: 'demo',
    runId,
    text,
    images,
    floorplans,
    brand: { ...config.brand },
    views: 0,
  });
}

const en = await buildDemo(SAMPLE_EN, {
  runIdPrefix: 'demo-en',
  photos: ['Living room', 'Master bedroom', 'Kitchen', 'Terrace', 'Lagoon view'],
  plans: ['Ground floor plan'],
});

const ar = await buildDemo(SAMPLE_AR, {
  runIdPrefix: 'demo-ar',
  photos: ['Reception', 'Bedroom', 'Bathroom', 'Balcony'],
  plans: ['Unit layout'],
});

await flushNow();
const sheet = await writeWorkbook();

console.log('\n  Demo presentations created:\n');
console.log(`   EN  ${config.baseUrl}/p/${en.id}`);
console.log(`   AR  ${config.baseUrl}/p/${ar.id}`);
console.log(`\n   spreadsheet: ${sheet}`);
console.log('\n  Run `npm start` and open the links.\n');

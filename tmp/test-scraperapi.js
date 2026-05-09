/**
 * tmp/test-scraperapi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPORARY test script — ScraperAPI trial
 * Does NOT modify or import anything from src/
 *
 * Usage:
 *   SCRAPERAPI_KEY=your_key node tmp/test-scraperapi.js
 *
 * Sign up free (5,000 trial requests): https://www.scraperapi.com/
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const axios = require('axios');
// No extra deps — uses regex only

const API_KEY = process.env.SCRAPERAPI_KEY || '';
const ENDPOINT = 'http://api.scraperapi.com/';

if (!API_KEY) {
  console.error('❌ SCRAPERAPI_KEY not set in .env');
  process.exit(1);
}

const TEST_IDS = [10014, 10016, 10023, 10026, 10038, 10055, 10061, 10079, 10001, 10005];

// ── Minimal parser (regex only, no extra deps) ───────────────────────────────
function extractStoreName(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = match ? match[1] : '';
  if (title.toLowerCase().includes('ace hardware') && !title.toLowerCase().includes('find')) {
    return title.replace(/\s*[\|\-–]\s*.*/,'').trim();
  }
  return null;
}

function extractFromJsonLd(html) {
  const matches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const tag of matches) {
    try {
      const json = JSON.parse(tag.replace(/<\/?script[^>]*>/gi, '').trim());
      const obj = Array.isArray(json) ? json[0] : json;
      if (obj['@type'] === 'HardwareStore' || obj['@type'] === 'LocalBusiness') {
        const addr = obj.address || {};
        return {
          storeName : obj.name || '',
          address   : [obj.streetAddress || addr.streetAddress, obj.addressLocality || addr.addressLocality, obj.addressRegion || addr.addressRegion, obj.postalCode || addr.postalCode].filter(Boolean).join(', '),
          city      : addr.addressLocality || obj.addressLocality || '',
          state     : addr.addressRegion  || obj.addressRegion  || '',
          zip       : addr.postalCode     || obj.postalCode     || '',
          phone     : obj.telephone || '',
        };
      }
    } catch (_) {}
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function testId(storeId) {
  const targetUrl = `https://www.acehardware.com/store-details/${storeId}`;

  try {
    const start = Date.now();
    const res = await axios.get(ENDPOINT, {
      params: {
        api_key: API_KEY,
        url: targetUrl,
        render: 'false',        // no JS rendering — cheaper credits
        premium: 'false',       // start without premium proxy to check credit cost
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    const elapsed = Date.now() - start;

    // ScraperAPI returns cost headers
    const creditCost = res.headers['sa-credit-cost'] || res.headers['x-credit-cost'] || '?';

    if (res.status !== 200) {
      return { storeId, status: res.status, creditCost, result: null, elapsed };
    }

    const data = extractFromJsonLd(res.data);
    const name = data?.storeName || extractStoreName(res.data);
    const isReal = !!(name && !name.toLowerCase().includes('find a store'));

    return { storeId, status: res.status, creditCost, result: isReal ? data : null, elapsed };
  } catch (e) {
    return { storeId, status: 'ERR', creditCost: '?', result: null, error: e.message, elapsed: 0 };
  }
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' ScraperAPI — Ace Hardware Cloudflare Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let found = 0;
  let totalCredits = 0;

  for (const id of TEST_IDS) {
    const { storeId, status, creditCost, result, elapsed, error } = await testId(id);

    if (result) {
      found++;
      console.log(`✅ ID ${storeId} → HTTP ${status} | ${creditCost} credits | ${elapsed}ms`);
      console.log(`   ${result.storeName} | ${result.city}, ${result.state} | ${result.phone}\n`);
    } else {
      console.log(`⬜ ID ${storeId} → HTTP ${status} | ${creditCost} credits | ${elapsed}ms${error ? ' | ' + error : ''}`);
    }

    if (!isNaN(Number(creditCost))) totalCredits += Number(creditCost);
    await new Promise(r => setTimeout(r, 500));
  }

  const avgCredits = totalCredits / TEST_IDS.length;
  console.log('\n━━━━━━━━━━━━━━━━ RESULT ━━━━━━━━━━━━━━━━━━━');
  console.log(` Found       : ${found}/${TEST_IDS.length} real stores`);
  console.log(` Avg credits : ~${avgCredits.toFixed(1)} per request`);
  console.log(` For 90K IDs : ~${Math.round(avgCredits * 90000).toLocaleString()} total credits needed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
})();

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.acehardware.com/store-details';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
];

function getHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'User-Agent': ua,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

function extractFromJsonLd($) {
  const result = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const nodes = item['@graph'] ? item['@graph'] : [item];
        for (const node of nodes) {
          const type = node['@type'] || '';
          if (type === 'LocalBusiness' || type === 'HardwareStore' || type === 'Store') {
            if (node.name) result.storeName = result.storeName || node.name;
            if (node.telephone) result.phone = result.phone || node.telephone;
            if (node.address) {
              const addr = node.address;
              result.address =
                result.address ||
                [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
                  .filter(Boolean)
                  .join(', ');
              result.city = result.city || addr.addressLocality;
              result.state = result.state || addr.addressRegion;
              result.zip = result.zip || addr.postalCode;
            }
            if (node.email) result.email = result.email || node.email;
            // Direct owner field: "owner": { "@type": "Person", "name": "..." }
            if (node.owner) {
              const owner = Array.isArray(node.owner) ? node.owner[0] : node.owner;
              if (owner && owner.name) result.owner = result.owner || owner.name;
            }
            // Employee list (some stores use this for manager/owner)
            if (node.employee) {
              const employees = Array.isArray(node.employee) ? node.employee : [node.employee];
              for (const emp of employees) {
                const jobTitle = (emp.jobTitle || '').toLowerCase();
                if (jobTitle.includes('manager')) result.manager = result.manager || emp.name;
                else if (jobTitle.includes('owner')) result.owner = result.owner || emp.name;
              }
            }
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  });
  return result;
}

function extractFromHtml($) {
  const result = {};

  function getValueAfterLabel($el) {
    const next = $el.next();
    if (next.length) return next.text().trim();
    return $el.parent().text().replace($el.text(), '').trim();
  }

  $('*').each((_, el) => {
    const $el = $(el);
    const text = $el.clone().children().remove().end().text().trim();
    const lower = text.toLowerCase();
    if (!result.manager && (lower === 'manager:' || lower === 'manager'))
      result.manager = getValueAfterLabel($el);
    if (!result.owner && (lower === 'owner:' || lower === 'owner'))
      result.owner = getValueAfterLabel($el);
    if (!result.email && (lower === 'email:' || lower === 'email'))
      result.email = getValueAfterLabel($el);
  });

  if (!result.email) {
    const emailMatch = $.html().match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/);
    if (emailMatch) result.email = emailMatch[0];
  }
  if (!result.storeName) {
    const h1 = $('h1').first().text().trim();
    if (h1) result.storeName = h1;
  }
  if (!result.phone) {
    const telLink = $('a[href^="tel:"]').first();
    if (telLink.length) result.phone = telLink.attr('href').replace('tel:', '').trim();
  }
  if (!result.address) {
    const addressEl = $('[itemprop="address"]').first();
    if (addressEl.length) result.address = addressEl.text().trim();
  }
  return result;
}

function parsePage(html, storeId) {
  const $ = cheerio.load(html);
  const jsonLdData = extractFromJsonLd($);
  const htmlData = extractFromHtml($);
  return {
    storeId,
    storeName: jsonLdData.storeName || htmlData.storeName || '',
    address: jsonLdData.address || htmlData.address || '',
    city: jsonLdData.city || '',
    state: jsonLdData.state || '',
    zip: jsonLdData.zip || '',
    phone: jsonLdData.phone || htmlData.phone || '',
    manager: jsonLdData.manager || htmlData.manager || '',
    owner: jsonLdData.owner || htmlData.owner || '',
    email: jsonLdData.email || htmlData.email || '',
    url: `${BASE_URL}/${storeId}`,
  };
}

// ---------------------------------------------------------------------------
// Fetch — proxy priority: ScraperAPI > ZenRows > direct HTTP
// ---------------------------------------------------------------------------

const SCRAPERAPI_KEY  = process.env.SCRAPERAPI_KEY  || '';
const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || '';
const SCRAPERAPI_ENDPOINT = 'https://api.scraperapi.com/';
const ZENROWS_ENDPOINT    = 'https://api.zenrows.com/v1/';

/**
 * Build an axios request config.
 * Priority:
 *   1. ScraperAPI  — if SCRAPERAPI_KEY is set  (10 credits/req on Cloudflare)
 *   2. ZenRows     — if ZENROWS_API_KEY is set  (10 credits/req on Cloudflare)
 *   3. Direct HTTP — fallback (works on fresh/residential IPs only)
 */
function buildRequest(storeUrl, timeout) {
  if (SCRAPERAPI_KEY) {
    // ScraperAPI automatically applies ultra-premium proxy for Cloudflare sites
    return {
      method: 'get',
      url: SCRAPERAPI_ENDPOINT,
      params: {
        api_key: SCRAPERAPI_KEY,
        url: storeUrl,
      },
      timeout,
      validateStatus: (s) => s < 500,
    };
  }

  if (ZENROWS_API_KEY) {
    // ZenRows: premium_proxy=true uses residential IPs → bypasses Cloudflare
    return {
      method: 'get',
      url: ZENROWS_ENDPOINT,
      params: {
        apikey: ZENROWS_API_KEY,
        url: storeUrl,
        premium_proxy: 'true',
      },
      timeout,
      validateStatus: (s) => s < 500,
    };
  }

  // Direct request (works on fresh/residential IPs)
  return {
    method: 'get',
    url: storeUrl,
    headers: getHeaders(),
    timeout,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
  };
}

/**
 * Fetch a single store page. Returns null if the store does not exist.
 * @param {number} storeId
 * @param {object} options
 * @param {number} options.timeout      - Request timeout in ms (default 15000)
 * @param {number} options.retries      - Number of retry attempts (default 2)
 * @param {number} options.retryDelay   - Delay between retries in ms (default 2000)
 * @param {Function} [options.onStatus] - Callback(storeId, statusCode) for logging
 * @returns {Promise<object|null>}
 */
async function fetchStore(storeId, options = {}) {
  const { timeout = 15000, retries = 2, retryDelay = 2000, onStatus } = options;
  const url = `${BASE_URL}/${storeId}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(buildRequest(url, timeout));

      if (onStatus) onStatus(storeId, response.status);

      if (response.status === 403 || response.status === 429) {
        // Rate limited — retry after delay
        if (attempt < retries) {
          await sleep(retryDelay * attempt);
          continue;
        }
        return null;
      }

      if (response.status === 404 || response.status !== 200) return null;

      const html = response.data;
      if (
        typeof html === 'string' &&
        (html.includes('Page Not Found') || html.includes('store not found'))
      ) {
        return null;
      }

      const record = parsePage(html, storeId);

      // Placeholder pages have no name or address — skip them
      if (!record.storeName && !record.address) return null;

      return record;
    } catch (err) {
      const isRetryable =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNABORTED' ||
        (err.response && err.response.status >= 500);

      if (isRetryable && attempt < retries) {
        await sleep(retryDelay * attempt);
        continue;
      }
      return null;
    }
  }
  return null;
}

module.exports = { fetchStore, parsePage };

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

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract store data from JSON-LD structured data embedded in the page.
 * Ace Hardware typically embeds schema.org/LocalBusiness markup.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object}
 */
function extractFromJsonLd($) {
  const result = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        // Could be wrapped in @graph
        const nodes = item['@graph'] ? item['@graph'] : [item];
        for (const node of nodes) {
          const type = node['@type'] || '';
          if (
            type === 'LocalBusiness' ||
            type === 'HardwareStore' ||
            type === 'Store'
          ) {
            if (node.name) result.storeName = result.storeName || node.name;
            if (node.telephone)
              result.phone = result.phone || node.telephone;
            if (node.address) {
              const addr = node.address;
              result.address =
                result.address ||
                [
                  addr.streetAddress,
                  addr.addressLocality,
                  addr.addressRegion,
                  addr.postalCode,
                ]
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
              const employees = Array.isArray(node.employee)
                ? node.employee
                : [node.employee];
              for (const emp of employees) {
                const jobTitle = (emp.jobTitle || '').toLowerCase();
                if (jobTitle.includes('manager')) {
                  result.manager = result.manager || emp.name;
                } else if (jobTitle.includes('owner')) {
                  result.owner = result.owner || emp.name;
                }
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

/**
 * Extract text from the "Store information" section in the HTML.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object}
 */
function extractFromHtml($) {
  const result = {};

  // Helper: get text from next sibling or following element after a label
  function getValueAfterLabel($el) {
    const next = $el.next();
    if (next.length) return next.text().trim();
    return $el.parent().text().replace($el.text(), '').trim();
  }

  // Find all text nodes that look like labels and grab their values
  $('*').each((_, el) => {
    const $el = $(el);
    const text = $el.clone().children().remove().end().text().trim();
    const lower = text.toLowerCase();

    if (!result.manager && (lower === 'manager:' || lower === 'manager')) {
      result.manager = getValueAfterLabel($el);
    }
    if (!result.owner && (lower === 'owner:' || lower === 'owner')) {
      result.owner = getValueAfterLabel($el);
    }
    if (!result.email && (lower === 'email:' || lower === 'email')) {
      result.email = getValueAfterLabel($el);
    }
  });

  // Fallback: search for email pattern in entire page text
  if (!result.email) {
    const fullText = $.html();
    const emailMatch = fullText.match(
      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
    );
    if (emailMatch) result.email = emailMatch[0];
  }

  // Store name from title or h1
  if (!result.storeName) {
    const h1 = $('h1').first().text().trim();
    if (h1) result.storeName = h1;
  }

  // Phone number fallback from tel: links
  if (!result.phone) {
    const telLink = $('a[href^="tel:"]').first();
    if (telLink.length) {
      result.phone = telLink.attr('href').replace('tel:', '').trim();
    }
  }

  // Address from meta or structured elements
  if (!result.address) {
    const addressEl = $('[itemprop="address"]').first();
    if (addressEl.length) result.address = addressEl.text().trim();
  }

  return result;
}

/**
 * Parse a store page HTML and return extracted fields.
 * @param {string} html
 * @param {number} storeId
 * @returns {object}
 */
function parsePage(html, storeId) {
  const $ = cheerio.load(html);
  const jsonLdData = extractFromJsonLd($);
  const htmlData = extractFromHtml($);

  // JSON-LD takes priority; HTML fallback fills gaps
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

/**
 * Fetch a single store page. Returns null if the store does not exist (404).
 * @param {number} storeId
 * @param {object} options
 * @param {number} options.timeout - Request timeout in ms (default 15000)
 * @param {number} options.retries - Number of retry attempts (default 3)
 * @param {number} options.retryDelay - Delay between retries in ms (default 2000)
 * @returns {Promise<object|null>}
 */
async function fetchStore(storeId, options = {}) {
  const { timeout = 15000, retries = 3, retryDelay = 2000 } = options;
  const url = `${BASE_URL}/${storeId}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: getHeaders(),
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      // 404 or redirected to a "not found" page — store doesn't exist
      if (response.status === 404) return null;
      if (response.status !== 200) return null;

      // Some sites return 200 but with "not found" content
      const html = response.data;
      if (
        typeof html === 'string' &&
        (html.includes('Page Not Found') ||
          html.includes('store not found') ||
          html.includes('404'))
      ) {
        return null;
      }

      const record = parsePage(html, storeId);

      // Placeholder pages return 200 with the generic 1-800 number but no
      // real store data. Skip them — a real store always has a name or address.
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
      // Network errors or final retry exhausted
      return null;
    }
  }
  return null;
}

module.exports = { fetchStore, parsePage };

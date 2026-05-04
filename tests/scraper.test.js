'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parsePage } = require('../src/scraper');

// ---------------------------------------------------------------------------
// Helpers — mock HTML fixtures
// ---------------------------------------------------------------------------

function makeJsonLdPage(jsonLd) {
  return `<!DOCTYPE html><html><head>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head><body><h1>Test Store</h1></body></html>`;
}

// ---------------------------------------------------------------------------
// parsePage — JSON-LD extraction
// ---------------------------------------------------------------------------
describe('parsePage – JSON-LD structured data', () => {
  test('extracts store name from LocalBusiness JSON-LD', () => {
    const html = makeJsonLdPage({
      '@context': 'https://schema.org',
      '@type': 'HardwareStore',
      name: 'Ace Hardware Springfield',
      telephone: '555-123-4567',
      email: 'springfield@acehardware.com',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main St',
        addressLocality: 'Springfield',
        addressRegion: 'IL',
        postalCode: '62701',
      },
    });

    const result = parsePage(html, 16750);
    assert.equal(result.storeId, 16750);
    assert.equal(result.storeName, 'Ace Hardware Springfield');
    assert.equal(result.phone, '555-123-4567');
    assert.equal(result.email, 'springfield@acehardware.com');
    assert.equal(result.city, 'Springfield');
    assert.equal(result.state, 'IL');
    assert.equal(result.zip, '62701');
    assert.ok(result.address.includes('123 Main St'));
  });

  test('extracts manager from employee array in JSON-LD', () => {
    const html = makeJsonLdPage({
      '@context': 'https://schema.org',
      '@type': 'HardwareStore',
      name: 'Ace Hardware Test',
      employee: [
        { '@type': 'Person', name: 'Jane Doe', jobTitle: 'Store Manager' },
        { '@type': 'Person', name: 'John Smith', jobTitle: 'Owner' },
      ],
    });

    const result = parsePage(html, 99999);
    assert.equal(result.manager, 'Jane Doe');
    assert.equal(result.owner, 'John Smith');
  });

  test('extracts manager from single employee object', () => {
    const html = makeJsonLdPage({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Ace Hardware Single',
      employee: { '@type': 'Person', name: 'Alice', jobTitle: 'Manager' },
    });

    const result = parsePage(html, 11111);
    assert.equal(result.manager, 'Alice');
  });

  test('handles @graph wrapper in JSON-LD', () => {
    const html = makeJsonLdPage({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'HardwareStore',
          name: 'Graph Store',
          email: 'graph@test.com',
        },
      ],
    });

    const result = parsePage(html, 12345);
    assert.equal(result.storeName, 'Graph Store');
    assert.equal(result.email, 'graph@test.com');
  });

  test('ignores malformed JSON-LD without throwing', () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{ this is not valid json }</script>
    </head><body><h1>Fallback Store</h1></body></html>`;

    assert.doesNotThrow(() => parsePage(html, 10001));
    const result = parsePage(html, 10001);
    assert.equal(result.storeName, 'Fallback Store');
  });
});

// ---------------------------------------------------------------------------
// parsePage — HTML fallback extraction
// ---------------------------------------------------------------------------
describe('parsePage – HTML label fallback', () => {
  test('extracts email from mailto link in HTML', () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="store-info">
        <span>Manager:</span><span>Bob Johnson</span>
        <span>Email:</span><span>bob@acetest.com</span>
      </div>
    </body></html>`;

    const result = parsePage(html, 20000);
    assert.equal(result.manager, 'Bob Johnson');
    assert.equal(result.email, 'bob@acetest.com');
  });

  test('falls back to email regex when no label found', () => {
    const html = `<!DOCTYPE html><html><body>
      Contact us at hidden@example.com for help
    </body></html>`;

    const result = parsePage(html, 20001);
    assert.equal(result.email, 'hidden@example.com');
  });

  test('extracts phone from tel: link', () => {
    const html = `<!DOCTYPE html><html><body>
      <a href="tel:+15551234567">Call us</a>
    </body></html>`;

    const result = parsePage(html, 20002);
    assert.equal(result.phone, '+15551234567');
  });

  test('populates url with correct store URL', () => {
    const result = parsePage('<html><body></body></html>', 16750);
    assert.equal(result.url, 'https://www.acehardware.com/store-details/16750');
  });

  test('returns empty strings for missing fields rather than undefined', () => {
    const result = parsePage('<html><body></body></html>', 99000);
    for (const key of ['storeName', 'manager', 'owner', 'email', 'phone', 'address']) {
      assert.equal(typeof result[key], 'string', `${key} should be a string`);
    }
  });
});

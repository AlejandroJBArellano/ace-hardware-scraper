'use strict';

require('dotenv').config();

const pLimit = require('p-limit').default;
const cliProgress = require('cli-progress');
const { fetchStore } = require('./scraper');
const { exportToExcel } = require('./exporter');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration (can be overridden via environment variables or .env file)
// ---------------------------------------------------------------------------
const CONFIG = {
  /** First store ID to try */
  ID_START: parseInt(process.env.ID_START || '10000', 10),
  /** Last store ID to try (inclusive) */
  ID_END: parseInt(process.env.ID_END || '25000', 10),
  /** Max concurrent HTTP requests */
  CONCURRENCY: parseInt(process.env.CONCURRENCY || '5', 10),
  /** Delay between batches in ms (be polite to the server) */
  BATCH_DELAY: parseInt(process.env.BATCH_DELAY || '500', 10),
  /** Request timeout in ms */
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT || '15000', 10),
  /** Number of retries per request */
  RETRIES: parseInt(process.env.RETRIES || '3', 10),
  /** Output file path */
  OUTPUT_PATH: process.env.OUTPUT_PATH || path.resolve(process.cwd(), 'output', 'stores.xlsx'),
};

/**
 * Generate an array of integers from start to end (inclusive).
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function range(start, end) {
  const ids = [];
  for (let i = start; i <= end; i++) ids.push(i);
  return ids;
}

/**
 * Main scraping pipeline.
 */
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       Ace Hardware Store Scraper         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Range:       ${CONFIG.ID_START} – ${CONFIG.ID_END}`);
  console.log(`Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log(`Output:      ${CONFIG.OUTPUT_PATH}`);
  console.log('');

  const ids = range(CONFIG.ID_START, CONFIG.ID_END);
  const total = ids.length;

  const bar = new cliProgress.SingleBar(
    {
      format:
        'Progress [{bar}] {percentage}% | {value}/{total} | Found: {found} | ETA: {eta}s',
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );

  bar.start(total, 0, { found: 0 });

  const limit = pLimit(CONFIG.CONCURRENCY);
  const results = [];
  let processed = 0;

  const tasks = ids.map((storeId) =>
    limit(async () => {
      const record = await fetchStore(storeId, {
        timeout: CONFIG.REQUEST_TIMEOUT,
        retries: CONFIG.RETRIES,
        retryDelay: CONFIG.BATCH_DELAY,
      });

      processed++;
      if (record) results.push(record);

      bar.update(processed, { found: results.length });
    }),
  );

  await Promise.all(tasks);
  bar.stop();

  console.log(`\n✓ Scraped ${total} IDs — found ${results.length} active stores.`);

  if (results.length === 0) {
    console.log('No stores found. Check your ID range or network connection.');
    return;
  }

  // Sort by store ID for consistent output
  results.sort((a, b) => a.storeId - b.storeId);

  console.log(`Exporting to Excel…`);
  const outputPath = await exportToExcel(results, CONFIG.OUTPUT_PATH);
  console.log(`✓ Saved → ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

'use strict';

/**
 * scrape-chunk.js — Runs the scraper for a specific chunk of IDs.
 * Designed to run inside a GitHub Actions matrix job.
 *
 * Environment variables:
 *   CHUNK         - 0-based chunk index (default: 0)
 *   TOTAL_CHUNKS  - total number of chunks (default: 10)
 *   ID_START      - first store ID in full range (default: 10000)
 *   ID_END        - last store ID in full range (default: 99999)
 *   CONCURRENCY   - parallel requests (default: 3)
 *   REQUEST_DELAY - ms to wait between requests per slot (default: 1000)
 *   REQUEST_TIMEOUT - axios timeout in ms (default: 15000)
 *   RETRIES       - retries per request (default: 2)
 */

require('dotenv').config();

const pLimit = require('p-limit').default;
const cliProgress = require('cli-progress');
const fs = require('fs');
const path = require('path');
const { fetchStore } = require('./scraper');

const CHUNK = parseInt(process.env.CHUNK || '0', 10);
const TOTAL_CHUNKS = parseInt(process.env.TOTAL_CHUNKS || '10', 10);
const ID_START = parseInt(process.env.ID_START || '10000', 10);
const ID_END = parseInt(process.env.ID_END || '99999', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY || '1000', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '15000', 10);
const RETRIES = parseInt(process.env.RETRIES || '2', 10);

// Calculate this chunk's ID range
const totalIds = ID_END - ID_START + 1;
const chunkSize = Math.ceil(totalIds / TOTAL_CHUNKS);
const chunkStart = ID_START + CHUNK * chunkSize;
const chunkEnd = Math.min(chunkStart + chunkSize - 1, ID_END);

function randomSleep(min) {
  const ms = min + Math.floor(Math.random() * min * 0.5);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n🚀 Chunk ${CHUNK + 1}/${TOTAL_CHUNKS} | Range: ${chunkStart}–${chunkEnd}`);
  console.log(`   Concurrency: ${CONCURRENCY} | Delay: ${REQUEST_DELAY}ms | Timeout: ${REQUEST_TIMEOUT}ms\n`);

  const ids = [];
  for (let i = chunkStart; i <= chunkEnd; i++) ids.push(i);

  const bar = new cliProgress.SingleBar(
    {
      format: 'Progress [{bar}] {percentage}% | {value}/{total} | Found: {found} | ETA: {eta}s',
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );

  bar.start(ids.length, 0, { found: 0 });

  const limit = pLimit(CONCURRENCY);
  const results = [];
  let processed = 0;
  const statusCounts = {};

  const tasks = ids.map((storeId) =>
    limit(async () => {
      await randomSleep(REQUEST_DELAY);

      const record = await fetchStore(storeId, {
        timeout: REQUEST_TIMEOUT,
        retries: RETRIES,
        retryDelay: 2000,
        onStatus: (id, status) => {
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          if (status === 403 || status === 429) {
            bar.log(`  ⛔ [${id}] blocked — HTTP ${status}\n`);
          }
        },
      });

      processed++;
      if (record) results.push(record);
      bar.update(processed, { found: results.length });
    }),
  );

  await Promise.all(tasks);
  bar.stop();

  const ok = statusCounts[200] || 0;
  const blocked = statusCounts[403] || 0;
  console.log(`\n✓ Chunk ${CHUNK}: ${results.length} stores found.`);
  console.log(`  HTTP 200: ${ok} | Blocked 403: ${blocked} | Other: ${ids.length - ok - blocked}`);

  // Save results as JSON artifact
  const outputDir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `chunk-${CHUNK}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`💾 Saved → ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

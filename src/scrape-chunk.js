'use strict';

/**
 * scrape-chunk.js — Runs the scraper for a specific chunk of IDs.
 * Designed to run inside a GitHub Actions matrix job.
 *
 * Environment variables:
 *   CHUNK              - 0-based chunk index (default: 0)
 *   TOTAL_CHUNKS       - total number of chunks (default: 10)
 *   ID_START           - first store ID in full range (default: 10000)
 *   ID_END             - last store ID in full range (default: 99999)
 *   CONCURRENCY        - parallel requests (default: 3)
 *   REQUEST_DELAY      - ms to wait between requests per slot (default: 1000)
 *   REQUEST_TIMEOUT    - axios timeout in ms (default: 15000)
 *   RETRIES            - retries per request (default: 2)
 *   BLOCK_THRESHOLD    - consecutive 403s before aborting (default: 20)
 */

require('dotenv').config();

const pLimit = require('p-limit').default;
const fs = require('fs');
const path = require('path');
const { fetchStore } = require('./scraper');

// ─── Config ─────────────────────────────────────────────────────────────────

const CHUNK = parseInt(process.env.CHUNK || '0', 10);
const TOTAL_CHUNKS = parseInt(process.env.TOTAL_CHUNKS || '10', 10);
const ID_START = parseInt(process.env.ID_START || '10000', 10);
const ID_END = parseInt(process.env.ID_END || '99999', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY || '1000', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '15000', 10);
const RETRIES = parseInt(process.env.RETRIES || '2', 10);
const BLOCK_THRESHOLD = parseInt(process.env.BLOCK_THRESHOLD || '20', 10);

// Calculate this chunk's ID range
const totalIds = ID_END - ID_START + 1;
const chunkSize = Math.ceil(totalIds / TOTAL_CHUNKS);
const chunkStart = ID_START + CHUNK * chunkSize;
const chunkEnd = Math.min(chunkStart + chunkSize - 1, ID_END);

// ─── GitHub Actions helpers ──────────────────────────────────────────────────

const isCI = process.env.CI === 'true';

const gha = {
  group: (name) => console.log(isCI ? `::group::${name}` : `\n▶ ${name}`),
  endGroup: () => { if (isCI) console.log('::endgroup::'); },
  error: (msg) => console.log(isCI ? `::error::${msg}` : `❌ ${msg}`),
  warning: (msg) => console.log(isCI ? `::warning::${msg}` : `⚠️  ${msg}`),
  notice: (msg) => console.log(isCI ? `::notice::${msg}` : `ℹ️  ${msg}`),
};

// ─── Stats ───────────────────────────────────────────────────────────────────

const stats = {
  processed: 0,
  http200: 0,
  http403: 0,
  http404: 0,
  http429: 0,
  http500: 0,
  httpOther: 0,
  networkErrors: 0,
  emptyPages: 0,   // 200 but no real store data (placeholder)
  storesFound: 0,  // stores saved to Excel
};

// Sliding window for IP-ban detection
const recentStatuses = [];
let abortSignaled = false;

function recordStatus(status) {
  recentStatuses.push(status);
  if (recentStatuses.length > BLOCK_THRESHOLD) recentStatuses.shift();
}

function isIPBanned() {
  if (recentStatuses.length < BLOCK_THRESHOLD) return false;
  const blocked = recentStatuses.filter((s) => s === 403 || s === 429).length;
  return blocked / recentStatuses.length >= 0.75; // 75%+ blocked = banned
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

function printSummary(label = 'Progress') {
  console.log(`\n[${ts()}] ── ${label} ──────────────────────────────`);
  console.log(`  Processed : ${stats.processed} / ${chunkEnd - chunkStart + 1}`);
  console.log(`  Stores    : ${stats.storesFound} real | ${stats.emptyPages} empty/placeholder`);
  console.log(`  HTTP 200  : ${stats.http200}`);
  console.log(`  HTTP 403  : ${stats.http403} (blocked)`);
  console.log(`  HTTP 404  : ${stats.http404} (not found)`);
  console.log(`  HTTP 429  : ${stats.http429} (rate limited)`);
  console.log(`  HTTP 500  : ${stats.http500} (server error)`);
  console.log(`  Other     : ${stats.httpOther}`);
  console.log(`  Net errors: ${stats.networkErrors}`);
  console.log(`──────────────────────────────────────────────────\n`);
}

// ─── Delay ───────────────────────────────────────────────────────────────────

function randomSleep(min) {
  const ms = min + Math.floor(Math.random() * min * 0.5);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  gha.group(`Chunk ${CHUNK + 1}/${TOTAL_CHUNKS} — IDs ${chunkStart}–${chunkEnd}`);
  console.log(`[${ts()}] Starting chunk ${CHUNK} | ${chunkEnd - chunkStart + 1} IDs`);
  console.log(`[${ts()}] Concurrency: ${CONCURRENCY} | Delay: ${REQUEST_DELAY}ms | Timeout: ${REQUEST_TIMEOUT}ms`);
  console.log(`[${ts()}] IP-ban threshold: ${BLOCK_THRESHOLD} consecutive blocks\n`);
  gha.endGroup();

  const ids = [];
  for (let i = chunkStart; i <= chunkEnd; i++) ids.push(i);

  const limit = pLimit(CONCURRENCY);
  const results = [];

  const tasks = ids.map((storeId) =>
    limit(async () => {
      // Abort if IP is banned or abort was signaled
      if (abortSignaled) return;

      await randomSleep(REQUEST_DELAY);

      if (abortSignaled) return;

      const record = await fetchStore(storeId, {
        timeout: REQUEST_TIMEOUT,
        retries: RETRIES,
        retryDelay: 2000,
        onStatus: (id, status) => {
          // Track all status codes
          if (status === 200) stats.http200++;
          else if (status === 403) stats.http403++;
          else if (status === 404) stats.http404++;
          else if (status === 429) stats.http429++;
          else if (status >= 500) stats.http500++;
          else if (status > 0) stats.httpOther++;
          else stats.networkErrors++;

          recordStatus(status);

          // Log blocked requests visibly
          if (status === 403 || status === 429) {
            console.log(`[${ts()}] ⛔ ID ${id} → HTTP ${status}`);
          }

          // Check for IP ban after each blocked response
          if (isIPBanned() && !abortSignaled) {
            abortSignaled = true;
            gha.error(
              `IP BAN DETECTED on chunk ${CHUNK}: ${stats.http403} 403s / ${stats.http429} 429s in last ${BLOCK_THRESHOLD} requests. Aborting chunk.`,
            );
            printSummary('Stats at abort');
          }
        },
      });

      stats.processed++;

      if (record) {
        stats.storesFound++;
        results.push(record);
        // Log every found store — visible in GHA logs
        console.log(
          `[${ts()}] ✅ FOUND  ID ${record.storeId} | ${record.storeName} | ${record.city}, ${record.state}`,
        );
      } else {
        // Null = 404, placeholder, or blocked — count as skipped
        stats.emptyPages++;
      }

      // Print a summary every 500 IDs processed
      if (stats.processed % 500 === 0) {
        printSummary(`Every-500 checkpoint (${stats.processed} done)`);
      }
    }),
  );

  await Promise.all(tasks);

  // ─── Final summary ──────────────────────────────────────────────────────────
  printSummary('FINAL SUMMARY');

  if (abortSignaled) {
    gha.error(`Chunk ${CHUNK} aborted due to IP ban. ${results.length} stores saved before abort.`);
    // Still save partial results so merge job can use them
  } else {
    gha.notice(`Chunk ${CHUNK} complete. ${results.length} stores found.`);
  }

  // ─── Save results ───────────────────────────────────────────────────────────
  const outputDir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `chunk-${CHUNK}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`[${ts()}] 💾 Saved ${results.length} stores → ${outputPath}`);

  // Exit with error code if aborted so GitHub marks the job as failed
  if (abortSignaled) process.exit(1);
}

main().catch((err) => {
  gha.error(`Fatal error in chunk ${CHUNK}: ${err.message}`);
  process.exit(1);
});

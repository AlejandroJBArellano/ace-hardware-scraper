'use strict';

/**
 * merge.js — Merges all chunk-N.json artifacts into a single stores.xlsx.
 * Run after all matrix jobs have completed and artifacts are downloaded.
 *
 * Expected directory structure:
 *   output/
 *     chunks/
 *       chunk-0/chunk-0.json
 *       chunk-1/chunk-1.json
 *       ...
 *     stores.xlsx  (output)
 */

const fs = require('fs');
const path = require('path');
const { exportToExcel } = require('./exporter');

async function main() {
  const chunksDir = path.resolve(process.cwd(), 'output', 'chunks');
  const outputPath = path.resolve(process.cwd(), 'output', 'stores.xlsx');

  if (!fs.existsSync(chunksDir)) {
    console.error('❌ No chunks directory found at', chunksDir);
    process.exit(1);
  }

  // Collect all JSON files recursively
  const allResults = [];
  const dirs = fs.readdirSync(chunksDir);

  for (const dir of dirs) {
    const jsonPath = path.join(chunksDir, dir, `${dir}.json`);
    if (!fs.existsSync(jsonPath)) continue;

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`  ✓ ${dir}.json → ${data.length} stores`);
    allResults.push(...data);
  }

  if (allResults.length === 0) {
    console.log('No stores found across all chunks.');
    process.exit(0);
  }

  // Sort by storeId for consistent output
  allResults.sort((a, b) => a.storeId - b.storeId);

  // Remove duplicates (in case ranges overlapped)
  const unique = [...new Map(allResults.map((s) => [s.storeId, s])).values()];

  console.log(`\n📊 Total: ${unique.length} unique stores from ${allResults.length} raw records`);
  console.log('Exporting to Excel…');

  const saved = await exportToExcel(unique, outputPath);
  console.log(`✅ Saved → ${saved}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

# ace-hardware-scraper

A Node.js scraper that visits every Ace Hardware store-detail page
(`https://www.acehardware.com/store-details/{id}`) and extracts the
**Store information** section — manager, owner, and email — then writes
all results to a formatted Excel workbook.

---

## Features

- Tries every store ID in a configurable numeric range
- Extracts **manager**, **owner**, **email**, store name, phone, and address
- Parses JSON-LD structured data first; falls back to HTML label matching
- Configurable concurrency with polite rate-limiting
- Automatic retries with exponential back-off on transient errors
- Outputs a styled `.xlsx` file with auto-filter, frozen header row, and hyperlinks
- All settings configurable via environment variables (`.env`)

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure (optional)

```bash
cp .env.example .env
# Edit .env to adjust the ID range, concurrency, etc.
```

### 3. Run

```bash
npm start
# or
node src/index.js
```

The Excel file will be written to `output/stores.xlsx` by default.

---

## Configuration

All settings can be set in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `ID_START` | `10000` | First store ID to probe |
| `ID_END` | `25000` | Last store ID to probe (inclusive) |
| `CONCURRENCY` | `5` | Concurrent HTTP requests |
| `BATCH_DELAY` | `500` | Base delay (ms) between retries |
| `REQUEST_TIMEOUT` | `15000` | HTTP timeout per request (ms) |
| `RETRIES` | `3` | Retry attempts per store before skipping |
| `OUTPUT_PATH` | `./output/stores.xlsx` | Destination Excel file path |

> **Tip:** Keep `CONCURRENCY ≤ 10` to avoid triggering rate-limits on the
> Ace Hardware website.

---

## Output

The generated Excel file contains one row per active store with the following columns:

| Column | Description |
|---|---|
| Store ID | Numeric store identifier |
| Store Name | Official store name |
| Manager | Store manager's name |
| Owner | Store owner's name |
| Email | Contact email |
| Phone | Contact phone number |
| Address | Full street address |
| City | City |
| State | State abbreviation |
| ZIP | ZIP / postal code |
| URL | Link to the original store page |

---

## Tests

```bash
npm test
```

Tests use Node.js's built-in test runner (no extra dependencies) and exercise the HTML/JSON-LD parser with fixture HTML.

---

## Project Structure

```
ace-hardware-scraper/
├── src/
│   ├── index.js      # Entry point — orchestrates scraping & export
│   ├── scraper.js    # Fetches and parses individual store pages
│   └── exporter.js   # Writes results to Excel
├── tests/
│   └── scraper.test.js
├── output/           # Generated Excel files (git-ignored)
├── .env.example      # Sample environment configuration
└── package.json
```

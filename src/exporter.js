'use strict';

const ExcelJS = require('exceljs');
const path = require('path');

const COLUMNS = [
  { header: 'Store ID', key: 'storeId', width: 12 },
  { header: 'Store Name', key: 'storeName', width: 35 },
  { header: 'Manager', key: 'manager', width: 25 },
  { header: 'Owner', key: 'owner', width: 25 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Phone', key: 'phone', width: 18 },
  { header: 'Address', key: 'address', width: 45 },
  { header: 'City', key: 'city', width: 20 },
  { header: 'State', key: 'state', width: 8 },
  { header: 'ZIP', key: 'zip', width: 12 },
  { header: 'URL', key: 'url', width: 50 },
];

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } },
  alignment: { vertical: 'middle', horizontal: 'center' },
  border: {
    bottom: { style: 'medium', color: { argb: 'FF1F4E79' } },
  },
};

/**
 * Export an array of store records to an Excel file.
 * @param {object[]} records
 * @param {string} [outputPath] - Destination file path (defaults to ./output/stores.xlsx)
 * @returns {Promise<string>} - Resolved path to the created file
 */
async function exportToExcel(records, outputPath) {
  const filePath =
    outputPath || path.resolve(process.cwd(), 'output', 'stores.xlsx');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ace-hardware-scraper';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Stores', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMNS;

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.style = HEADER_STYLE;
  });
  headerRow.height = 20;

  // Add data rows
  records.forEach((record, idx) => {
    const row = sheet.addRow(record);
    row.height = 15;

    // Alternating row background
    if (idx % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      });
    }

    // Make URL a hyperlink
    const urlCell = row.getCell('url');
    urlCell.value = {
      text: record.url,
      hyperlink: record.url,
    };
    urlCell.font = { color: { argb: 'FF0563C1' }, underline: true };
  });

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Ensure output directory exists
  const { mkdir } = require('fs/promises');
  await mkdir(path.dirname(filePath), { recursive: true });

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { exportToExcel };

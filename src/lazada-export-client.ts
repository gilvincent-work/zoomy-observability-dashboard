/**
 * Browser-side parsing of the Lazada Seller-Center `.xlsx` order export.
 *
 * ExcelJS is imported dynamically so it stays out of the main bundle, following
 * reviews-xlsx.client.js. Parsing happens here rather than on the server on
 * purpose: unzipping and walking a 250KB spreadsheet would spend the Oxygen
 * worker's CPU budget on work the browser does for free. Only the normalized
 * rows — a small JSON payload — cross the wire to the route action.
 *
 * The transforms themselves live in lazada-export.js (pure, unit-tested); this
 * module is only the file/sheet plumbing.
 */

import {REQUIRED_HEADERS, rowsToOrderItems, summarizeExclusions} from './lazada-export';
import type {LazadaSheetRow} from './lazada-types';

/**
 * The slice of ExcelJS's worksheet API this parser touches. Typing it
 * structurally keeps the dynamic import (which is what keeps a ~900KB library
 * out of the initial bundle) from dragging the whole type surface in.
 */
type CellLike = {value?: unknown};
type RowLike = {cellCount?: number; getCell: (c: number) => CellLike};
type WorkSheetLike = {rowCount?: number; getRow: (r: number) => RowLike};

async function getExcelJS() {
  const mod = await import('exceljs');
  return (mod as unknown as {default?: typeof mod}).default ?? mod;
}

/**
 * Lazada's header labels, mapped to the internal keys the pure module expects.
 * The export's own header text varies slightly between Seller-Center versions
 * (and between the "orders" and "order items" export flavors), so each key
 * accepts several spellings and is matched case/space/punctuation-insensitively.
 */
const HEADER_ALIASES = {
  orderItemId: ['orderitemid', 'orderiteminfo', 'itemid'],
  orderNumber: ['ordernumber', 'orderid', 'orderno'],
  createTime: ['createtime', 'ordercreatetime', 'createdat', 'orderdate'],
  status: ['status', 'orderstatus', 'itemstatus'],
  shippingName: ['shippingname', 'shipname', 'recipientname', 'shippingaddressname'],
  billingName: ['billingname', 'billname'],
  customerName: ['customername', 'buyername', 'buyer'],
  billingPhone: ['billingphone', 'billingphonenumber', 'billphone', 'phone', 'phonenumber'],
  billingCity: ['billingcity', 'billcity'],
  shippingCity: ['shippingcity', 'shipcity'],
  itemName: ['itemname', 'productname', 'name', 'skuname'],
  variation: ['variation', 'variant', 'variationname'],
  paidPrice: ['paidprice', 'paidamount', 'totalpaid', 'paid'],
  shippingFee: ['shippingfee', 'shippingfees', 'deliveryfee'],
  payMethod: ['paymethod', 'paymentmethod', 'payment'],
};

/** Collapse a header cell to a comparison key: lowercase, alphanumerics only. */
function headerKey(text: unknown): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Read a cell to a trimmed string, tolerating rich-text/formula/date shapes. */
function cellValue(cell: {value?: unknown} | undefined): string | Date {
  const v = cell?.value as unknown;
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as {text?: unknown; result?: unknown; richText?: Array<{text?: unknown}>};
    if ('text' in o) return String(o.text).trim();
    if ('result' in o) return String(o.result).trim();
    if ('richText' in o) return (o.richText ?? []).map((t) => String(t?.text ?? '')).join('').trim();
    return '';
  }
  return String(v).trim();
}

/**
 * Locate the header row and build a column index for it.
 *
 * The export sometimes carries a title/filter line above the real headers, so
 * rather than assuming row 1 we scan the first few rows and take the one that
 * matches the most known columns.
 *
 * @returns {{row: number, columns: Record<string, number>, matched: number}}
 */
type HeaderMatch = {row: number; columns: Record<string, number>; matched: number};

function findHeaderRow(ws: WorkSheetLike): HeaderMatch {
  let best: HeaderMatch = {row: 0, columns: {}, matched: 0};
  const limit = Math.min(ws.rowCount || 1, 10);

  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    const columns: Record<string, number> = {};
    const count = row.cellCount || 0;
    for (let c = 1; c <= count; c++) {
      const key = headerKey(cellValue(row.getCell(c)));
      if (!key) continue;
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (columns[field] === undefined && aliases.includes(key)) {
          columns[field] = c;
          break;
        }
      }
    }
    const matched = Object.keys(columns).length;
    if (matched > best.matched) best = {row: r, columns, matched};
  }
  return best;
}

/**
 * Parse an export workbook into records ready to POST to the route action.
 *
 * Pure with respect to the DOM — takes an ArrayBuffer (the component calls
 * `File.arrayBuffer()`), returns plain objects — so it is testable in node.
 *
 * @param {ArrayBuffer|Buffer} buffer
 * @returns {Promise<{items: Array<object>, total: number, skipped: object, error: string|null}>}
 */
export async function parseLazadaWorkbook(buffer: ArrayBuffer) {
  const empty = {items: [], total: 0, skipped: {status: 0, phone: 0, date: 0, id: 0}, exclusions: {excludedItems: 0, excludedBuyers: 0}, buyers: 0};
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return {...empty, error: 'Could not read that file as .xlsx. Export again from Seller Center without opening it in another tool.'};
  }

  // Take the first sheet that yields a usable header row; Lazada names the
  // sheet after the export batch, so it cannot be looked up by name.
  // Assigned inside the callback, then read back through explicit locals:
  // TypeScript cannot narrow a variable a closure writes to.
  let foundSheet: WorkSheetLike | null = null;
  let foundHeader: HeaderMatch | null = null;
  wb.eachSheet((ws: unknown) => {
    if (foundSheet) return;
    const worksheet = ws as WorkSheetLike;
    const found = findHeaderRow(worksheet);
    if (found.matched >= 4) {
      foundSheet = worksheet;
      foundHeader = found;
    }
  });
  const sheet = foundSheet as WorkSheetLike | null;
  const header = foundHeader as HeaderMatch | null;

  if (!sheet || !header) {
    return {...empty, error: `No Lazada order sheet found. Expected columns like: ${REQUIRED_HEADERS.slice(0, 5).join(', ')}.`};
  }

  const missing = ['orderItemId', 'createTime', 'billingPhone'].filter(
    (f) => header.columns[f] === undefined,
  );
  if (missing.length) {
    return {...empty, error: `The export is missing required column(s): ${missing.join(', ')}.`};
  }

  const rows: LazadaSheetRow[] = [];
  for (let r = header.row + 1; r <= (sheet.rowCount ?? 0); r++) {
    const row = sheet.getRow(r);
    const record: LazadaSheetRow = {};
    let hasValue = false;
    for (const [field, col] of Object.entries(header.columns)) {
      const value = cellValue(row.getCell(col));
      record[field] = value;
      if (value !== '') hasValue = true;
    }
    if (hasValue) rows.push(record);
  }

  const {items, skipped} = rowsToOrderItems(rows);
  // Reported to the user right after parsing: excluded rows are never stored, so
  // this is the only moment the "buyers dropped by status" figure can be known.
  const exclusions = summarizeExclusions(rows);
  const buyers = new Set(items.map((i) => i.phone)).size;
  return {items, total: rows.length, skipped, exclusions, buyers, error: null};
}

import {describe, it, expect} from 'vitest';
import ExcelJS from 'exceljs';
import {parseLazadaWorkbook} from '../src/lazada-export-client';

/**
 * Build a stand-in for the Seller-Center export. `headers` lets each test use a
 * different spelling of the column labels, which is the thing most likely to
 * change under us between Seller-Center versions.
 */
async function workbook({
  headers,
  rows,
  leadingJunkRow = false,
  sheetName = 'Export_20260730',
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
  leadingJunkRow?: boolean;
  sheetName?: string;
}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  if (leadingJunkRow) ws.addRow(['Lazada PH — orders export', '', 'generated 30 Jul 2026']);
  ws.addRow(headers);
  rows.forEach((r: Array<string | number>) => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

const HEADERS = [
  'orderItemId', 'orderNumber', 'createTime', 'status',
  'shippingName', 'billingName', 'customerName',
  'billingPhone', 'billingCity', 'shippingCity', 'itemName',
  'variation', 'paidPrice', 'shippingFee', 'payMethod',
];
const ROW = [
  '90001', '5001', '30 Jul 2026 14:35', 'delivered',
  'Ana Cruz', 'Ana C', '********123',
  '6309171234567', 'Quezon City', 'Quezon City', 'Zoomy! Meaty Treats',
  'Type:Beef Liver', '184.00', '45.00', 'GCASH_PP',
];

describe('parseLazadaWorkbook', () => {
  it('parses a well-formed export into storable order items', async () => {
    const buf = await workbook({headers: HEADERS, rows: [ROW]});
    const out = await parseLazadaWorkbook(buf);
    expect(out.error).toBeNull();
    expect(out.total).toBe(1);
    expect(out.items).toEqual([
      {
        order_item_id: '90001',
        order_number: '5001',
        ordered_at: '2026-07-30T06:35:00.000Z',
        status: 'delivered',
        customer_name: 'Ana Cruz',
        city: 'Quezon City',
        phone: '+639171234567',
        item_name: 'Zoomy! Meaty Treats',
        variation: 'Beef Liver',
        paid_price: 184,
        shipping_fee: 45,
        pay_method: 'GCash',
      },
    ]);
  });

  it('finds the header row when a title line sits above it', async () => {
    const buf = await workbook({headers: HEADERS, rows: [ROW], leadingJunkRow: true});
    const out = await parseLazadaWorkbook(buf);
    expect(out.error).toBeNull();
    expect(out.items).toHaveLength(1);
  });

  it('matches header labels regardless of case, spacing and punctuation', async () => {
    const buf = await workbook({
      headers: [
        'Order Item ID', 'Order Number', 'Create Time', 'Status',
        'Shipping Name', 'Billing Name', 'Customer Name',
        'Billing Phone', 'Billing City', 'Shipping City', 'Item Name',
      ],
      rows: [ROW],
    });
    const out = await parseLazadaWorkbook(buf);
    expect(out.error).toBeNull();
    expect(out.items[0].phone).toBe('+639171234567');
  });

  it('skips blank rows and reports why unusable rows were dropped', async () => {
    const buf = await workbook({
      headers: HEADERS,
      rows: [
        ROW,
        ['90002', '5002', '30 Jul 2026 14:35', 'canceled', 'B', '', '', '6309171234568', 'Makati', '', 'Treats', '', '99.00', '0.00', 'COD'],
        ['90003', '5003', '30 Jul 2026 14:35', 'delivered', 'C', '', '', 'n/a', 'Makati', '', 'Treats', '', '99.00', '0.00', 'COD'],
        [],
        [],
      ],
    });
    const out = await parseLazadaWorkbook(buf);
    expect(out.total).toBe(3); // blank rows are not counted
    expect(out.items).toHaveLength(1);
    expect(out.skipped).toMatchObject({status: 1, phone: 1});
  });

  it('reports a friendly error for a file that is not a workbook', async () => {
    const out = await parseLazadaWorkbook(new TextEncoder().encode('not a spreadsheet').buffer);
    expect(out.items).toEqual([]);
    expect(out.error).toMatch(/could not read/i);
  });

  it('reports an error when the sheet has no recognizable order columns', async () => {
    const buf = await workbook({headers: ['alpha', 'beta', 'gamma'], rows: [['1', '2', '3']]});
    const out = await parseLazadaWorkbook(buf);
    expect(out.items).toEqual([]);
    expect(out.error).toMatch(/no lazada order sheet/i);
  });

  it('reports which required column is missing', async () => {
    // Recognizable as an order sheet, but with no phone column to text.
    const buf = await workbook({
      headers: ['orderItemId', 'orderNumber', 'createTime', 'status', 'shippingName', 'itemName'],
      rows: [['90001', '5001', '30 Jul 2026 14:35', 'delivered', 'Ana', 'Treats']],
    });
    const out = await parseLazadaWorkbook(buf);
    expect(out.items).toEqual([]);
    expect(out.error).toMatch(/billingPhone/);
  });
});

describe('parseLazadaWorkbook — order economics', () => {
  it('reads the money and variant columns under their real header labels', async () => {
    const buf = await workbook({
      headers: [
        'Order Item ID', 'Order Number', 'Create Time', 'Status', 'Shipping Name',
        'Billing Phone', 'Billing City', 'Item Name', 'Variation', 'Paid Price',
        'Shipping Fee', 'Pay Method',
      ],
      rows: [[
        '90001', '5001', '30 Jul 2026 14:35', 'delivered', 'Ana Cruz',
        '6309171234567', 'Quezon City', 'Freeze Dried Munchies',
        'Pet Food Flavors & Ingredients:Chicken', '1,234.56', '45.00', 'MIXEDCARD',
      ]],
    });
    const out = await parseLazadaWorkbook(buf);
    expect(out.error).toBeNull();
    expect(out.items[0]).toMatchObject({
      variation: 'Chicken',
      paid_price: 1234.56,
      shipping_fee: 45,
      pay_method: 'Card',
    });
  });

  it('leaves the economics null when those columns are absent', async () => {
    const buf = await workbook({
      headers: ['orderItemId', 'createTime', 'status', 'shippingName', 'billingPhone', 'itemName'],
      rows: [['90001', '30 Jul 2026 14:35', 'delivered', 'Ana', '6309171234567', 'Treats']],
    });
    const out = await parseLazadaWorkbook(buf);
    expect(out.error).toBeNull();
    expect(out.items[0]).toMatchObject({paid_price: null, pay_method: null, variation: null});
  });
});

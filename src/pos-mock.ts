import type {PosProductRow, PosBundleRow} from './pos-types';

// Mock catalog for local dashboard work when the Supabase pos_* env is absent
// (mirrors src/mock.ts for digests). Matches the 26-SKU masterfile + the flat
// per-line pricing seeded on Staging; stock values are illustrative.
export const MOCK_POS_PRODUCTS: PosProductRow[] = [
  {product_id: 'ZMYFDMEATSLMWHL01', name: 'Meaty Treats Salmon', product_line: 'MEAT', category: 'Meaty Treats', subcategory: null, emoji: '🐟', active: true, price: 200, stock: 42, next_expiry: null},
  {product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', product_line: 'MEAT', category: 'Meaty Treats', subcategory: null, emoji: '🥩', active: true, price: 200, stock: 8, next_expiry: null},
  {product_id: 'ZMYFDMEATDCKWHL01', name: 'Meaty Treats Duck', product_line: 'MEAT', category: 'Meaty Treats', subcategory: null, emoji: null, active: true, price: 200, stock: 50, next_expiry: null},
  {product_id: 'ZMYFDMEATCHKWHL01', name: 'Meaty Treats Chicken', product_line: 'MEAT', category: 'Meaty Treats', subcategory: null, emoji: null, active: true, price: 200, stock: 0, next_expiry: null},
  {product_id: 'ZMYFDJRKCHKWHL01', name: 'Tasty Treats Chicken Jerky', product_line: 'JRK', category: 'Tasty Treats', subcategory: null, emoji: '🍗🦴', active: true, price: 300, stock: 33, next_expiry: null},
  {product_id: 'ZMYFDJRKDCKWHL01', name: 'Tasty Treats Duck Jerky', product_line: 'JRK', category: 'Tasty Treats', subcategory: null, emoji: null, active: true, price: 300, stock: 21, next_expiry: null},
  {product_id: 'ZMYFDJRKCHKCAR01', name: 'Super Duo Bites Chicken Carrot', product_line: 'JRK', category: 'Tasty Treats', subcategory: null, emoji: null, active: true, price: 300, stock: 15, next_expiry: null},
  {product_id: 'ZMYFDJRKDCKCAR01', name: 'Super Duo Bites Duck Carrot', product_line: 'JRK', category: 'Tasty Treats', subcategory: null, emoji: null, active: true, price: 300, stock: 9, next_expiry: null},
  {product_id: 'ZMYFDJRKDCKPER01', name: 'Super Duo Bites Duck Pear', product_line: 'JRK', category: 'Tasty Treats', subcategory: null, emoji: null, active: false, price: 300, stock: 0, next_expiry: null},
  {product_id: 'ZMYFDFDRSLMCUB01', name: 'Freeze-Dried Salmon Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 40, next_expiry: '2026-12-01'},
  {product_id: 'ZMYFDFDRCAPWHL01', name: 'Freeze-Dried Capelin', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 25, next_expiry: '2026-11-15'},
  {product_id: 'ZMYFDFDRLMBLVR01', name: 'Freeze-Dried Lamb Liver Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 18, next_expiry: '2027-01-10'},
  {product_id: 'ZMYFDFDRDCKBRT01', name: 'Freeze-Dried Duck Breast Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 50, next_expiry: '2027-02-01'},
  {product_id: 'ZMYFDFDRCHKBRT01', name: 'Freeze-Dried Chicken Breast Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 6, next_expiry: '2026-10-20'},
  {product_id: 'ZMYFDFDRCHKLVR01', name: 'Freeze-Dried Chicken Liver Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 30, next_expiry: '2026-12-05'},
  {product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 27, next_expiry: '2026-12-05'},
  {product_id: 'ZMYFDFDRCGRCUB01', name: 'Freeze-Dried Cat Grass Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 12, next_expiry: '2027-03-01'},
  {product_id: 'ZMYFDFDRCGRSTK01', name: 'Freeze-Dried Cat Grass Stick', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 14, next_expiry: '2027-03-01'},
  {product_id: 'ZMYFDFDRYOGWHL01', name: 'Freeze-Dried Yoghurt Cubes', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 22, next_expiry: '2026-11-30'},
  {product_id: 'ZMYFDFDRDCKAPP01', name: 'Freeze-Dried Duck Apple', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 19, next_expiry: '2027-01-20'},
  {product_id: 'ZMYFDFDRDCKPER01', name: 'Freeze-Dried Duck Pear', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 17, next_expiry: '2027-01-20'},
  {product_id: 'ZMYFDFDRCHKCRA01', name: 'Freeze-Dried Chicken Cranberry', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 3, next_expiry: '2026-10-10'},
  {product_id: 'ZMYFDFDRCHKPUM01', name: 'Freeze-Dried Chicken Pumpkin', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 28, next_expiry: '2026-12-15'},
  {product_id: 'ZMYFDFDRSLMWHL01', name: 'Freeze-Dried Salmon Steak', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 35, next_expiry: '2026-12-01'},
  {product_id: 'ZMYFDFDRCHKEGG01', name: 'Freeze-Dried Chicken & Egg', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 24, next_expiry: '2026-11-25'},
  {product_id: 'ZMYFDFDRBEFBLU01', name: 'Freeze-Dried Beef Blueberry', product_line: 'FDR', category: 'Freeze Dried', subcategory: null, emoji: null, active: true, price: 170, stock: 11, next_expiry: '2027-02-14'},
];

export const MOCK_POS_BUNDLES: PosBundleRow[] = [
  {bundle_id: 'mock-bundle-1', name: 'Buy Any 4', price: 570, active: true, bundle_type: 'pick', pick_count: 4, line_categories: ['Meaty Treats', 'Freeze Dried'], emoji: '🐟🥩', items: []},
  {bundle_id: 'mock-bundle-2', name: 'Buy Any 2', price: 550, active: true, bundle_type: 'pick', pick_count: 2, line_categories: ['Tasty Treats', 'Super Duo Bites'], emoji: '🐔🥕🦴', items: []},
  {bundle_id: 'mock-bundle-3', name: 'Buy Any 3 - Sample ni Lance', price: 6767, active: true, bundle_type: 'pick', pick_count: 3, line_categories: ['Freeze Dried', 'Meaty Treats', 'Tasty Treats'], emoji: null, items: []},
];

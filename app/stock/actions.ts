'use server';

import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {getDataContext} from '@/src/active-context';
import {canEditData, outOfScopeStores} from '@/src/company';
import {manilaDate} from '@/src/goldline-supply';
import {
  cancelShipment,
  existingItems,
  existingLines,
  existingStores,
  recordShipment,
  saveSupplySettings,
  setHidden,
  setPrice,
  setWarehouseStock,
  shipmentStore,
  SupplyError,
} from '@/src/goldline-supply-writes';

// Server actions behind the Goldline Inventory board's controls. Each re-derives the
// tenant context server-side, re-checks write capability and store scope, validates
// input, then writes. A store-scoped role can only touch its own stores, and can't
// change company-wide settings (defaults, production lead times, warehouse, catalog).

export type ActionResult<T = object> = ({ok: true} & T) | {ok: false; error: string};

const ITEM = /^.{1,80}$/;
const MAX_QTY = 100_000;

async function editorContext(company: string | null) {
  const ctx = await getDataContext(company);
  if (!ctx || !ctx.companyId) return {error: 'Not authorized for this company.'} as const;
  if (!canEditData(ctx.role)) return {error: 'Your role can’t change inventory.'} as const;
  // A store-scoped role with no stores assigned can touch nothing (never "unrestricted").
  if (Array.isArray(ctx.storeScope) && ctx.storeScope.length === 0) return {error: 'No stores are assigned to your role.'} as const;
  const session = await auth();
  return {ctx, companyId: ctx.companyId, by: session?.user?.email ?? null} as const;
}

const intIn = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null);

function refresh() {
  revalidatePath('/stock', 'layout');
  revalidatePath('/action-feed');
}

export async function recordShipmentAction(input: {company: string | null; store: string; item: string; qty: number}): Promise<ActionResult<{arrivesOn: string | null}>> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  const qty = intIn(input.qty, 1, MAX_QTY);
  if (!qty) return {ok: false, error: 'Enter how many units to send (1 or more).'};
  if (!input.store || !ITEM.test(input.item ?? '')) return {ok: false, error: 'Pick a store and a product.'};
  if (outOfScopeStores(e.ctx.storeScope, [input.store]).length) return {ok: false, error: `Store ${input.store} is outside your access.`};
  try {
    const [items, stores] = await Promise.all([existingItems(e.companyId, [input.item]), existingStores(e.companyId, [input.store])]);
    if (!items.has(input.item) || !stores.has(input.store)) return {ok: false, error: 'That store or product isn’t in this company.'};
    await recordShipment(e.companyId, input.store, input.item, qty, e.by, manilaDate());
    refresh();
    return {ok: true, arrivesOn: null};
  } catch (err) {
    if (err instanceof SupplyError && err.code === 'not_enough_stock') {
      return {ok: false, error: `Only ${err.detail ?? 0} in the warehouse — send ${err.detail ?? 0} or fewer, or update the warehouse stock first.`};
    }
    console.error('recordShipmentAction', err);
    return {ok: false, error: 'Could not record the shipment. Please try again.'};
  }
}

export async function cancelShipmentAction(input: {company: string | null; id: string}): Promise<ActionResult> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  if (!/^[0-9a-f-]{36}$/i.test(input.id ?? '')) return {ok: false, error: 'Shipment not found.'};
  try {
    const store = await shipmentStore(e.companyId, input.id);
    if (!store) return {ok: false, error: 'Shipment not found.'};
    if (outOfScopeStores(e.ctx.storeScope, [store]).length) return {ok: false, error: `Store ${store} is outside your access.`};
    await cancelShipment(e.companyId, input.id, e.by, manilaDate());
    refresh();
    return {ok: true};
  } catch (err) {
    if (err instanceof SupplyError && err.code === 'not_in_transit') return {ok: false, error: 'That shipment was already cancelled.'};
    if (err instanceof SupplyError && err.code === 'already_arrived') {
      return {ok: false, error: 'That shipment is due to have arrived — the store’s next count records it, so it can’t be cancelled.'};
    }
    console.error('cancelShipmentAction', err);
    return {ok: false, error: 'Could not cancel the shipment. Please try again.'};
  }
}

export async function setWarehouseStockAction(input: {company: string | null; item: string; onHand: number}): Promise<ActionResult> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  if (e.ctx.storeScope) return {ok: false, error: 'Only company-wide roles can change warehouse stock.'};
  const onHand = intIn(input.onHand, 0, 10_000_000);
  if (onHand == null) return {ok: false, error: 'Enter a whole number, 0 or more.'};
  if (!ITEM.test(input.item ?? '')) return {ok: false, error: 'Product not found.'};
  try {
    if (!(await existingItems(e.companyId, [input.item])).has(input.item)) return {ok: false, error: 'Product not found.'};
    await setWarehouseStock(e.companyId, input.item, onHand, e.by);
    refresh();
    return {ok: true};
  } catch (err) {
    console.error('setWarehouseStockAction', err);
    return {ok: false, error: 'Could not save the warehouse stock. Please try again.'};
  }
}

export async function setPriceAction(input: {company: string | null; item: string; price: number}): Promise<ActionResult> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  if (e.ctx.storeScope) return {ok: false, error: 'Only company-wide roles can change prices.'};
  const price = typeof input.price === 'number' && Number.isFinite(input.price) && input.price >= 0 && input.price <= 1_000_000 ? Math.round(input.price * 100) / 100 : null;
  if (price == null) return {ok: false, error: 'Enter a price of ₱0 or more.'};
  if (!ITEM.test(input.item ?? '')) return {ok: false, error: 'Product not found.'};
  try {
    await setPrice(e.companyId, input.item, price, e.by);
    refresh();
    return {ok: true};
  } catch (err) {
    if (err instanceof SupplyError) return {ok: false, error: 'Product not found.'};
    console.error('setPriceAction', err);
    return {ok: false, error: 'Could not change the price. Please try again.'};
  }
}

export async function setHiddenAction(input: {company: string | null; item: string; hidden: boolean}): Promise<ActionResult> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  if (e.ctx.storeScope) return {ok: false, error: 'Only company-wide roles can hide products.'};
  if (!ITEM.test(input.item ?? '')) return {ok: false, error: 'Product not found.'};
  try {
    await setHidden(e.companyId, input.item, Boolean(input.hidden));
    refresh();
    return {ok: true};
  } catch (err) {
    if (err instanceof SupplyError) return {ok: false, error: 'Product not found.'};
    console.error('setHiddenAction', err);
    return {ok: false, error: 'Could not update the product. Please try again.'};
  }
}

export async function saveSupplySettingsAction(input: {
  company: string | null;
  defaults: {productionDays: number; transitDays: number} | null;
  lines: Array<{line: string; days: number}>;
  stores: Array<{store: string; days: number}>;
}): Promise<ActionResult> {
  const e = await editorContext(input.company);
  if ('error' in e) return {ok: false, error: e.error as string};
  const scoped = Boolean(e.ctx.storeScope);
  if (scoped && (input.defaults || input.lines?.length)) return {ok: false, error: 'Only company-wide roles can change production times or defaults.'};
  if (input.defaults && (intIn(input.defaults.productionDays, 0, 365) == null || intIn(input.defaults.transitDays, 0, 60) == null)) {
    return {ok: false, error: 'Defaults: production 0–365 days, delivery 0–60 days.'};
  }
  const lines = (input.lines ?? []).slice(0, 500);
  const stores = (input.stores ?? []).slice(0, 1000);
  if (lines.some((l) => !l.line || l.line.length > 200 || intIn(l.days, 0, 365) == null)) return {ok: false, error: 'Production times must be 0–365 days.'};
  if (stores.some((s) => !s.store || intIn(s.days, 0, 60) == null)) return {ok: false, error: 'Delivery times must be 0–60 days.'};
  const out = outOfScopeStores(e.ctx.storeScope, stores.map((s) => s.store));
  if (out.length) return {ok: false, error: `Store ${out[0]} is outside your access.`};
  try {
    const [knownStores, knownLines] = await Promise.all([existingStores(e.companyId, stores.map((s) => s.store)), existingLines(e.companyId, lines.map((l) => l.line))]);
    if (stores.some((s) => !knownStores.has(s.store)) || lines.some((l) => !knownLines.has(l.line))) {
      return {ok: false, error: 'A store or product line isn’t in this company. Reload and try again.'};
    }
    await saveSupplySettings(e.companyId, {defaults: input.defaults, lines, stores}, e.by);
    refresh();
    return {ok: true};
  } catch (err) {
    console.error('saveSupplySettingsAction', err);
    return {ok: false, error: 'Could not save the settings. Please try again.'};
  }
}

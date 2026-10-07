import {describe, expect, it} from 'vitest';
import {dashboardLinks, pageContextLine, readPageInput, resolvePage} from '../src/chat/pages';

describe('resolvePage', () => {
  it('matches exact and dynamic routes, never a prefix of a word', () => {
    expect(resolvePage('/inventory')?.route).toBe('/inventory');
    expect(resolvePage('/inventory/P1')?.route).toBe('/inventory/[sku]');
    expect(resolvePage('/offline-sales/events')?.route).toBe('/offline-sales/events');
    expect(resolvePage('/inventoryX')).toBeNull();
    expect(resolvePage('/nope')).toBeNull();
  });
});

describe('readPageInput', () => {
  it('accepts only a short path starting with /', () => {
    expect(readPageInput({path: '/inventory', query: 'tab=all'})).toEqual({path: '/inventory', query: 'tab=all'});
    expect(readPageInput({path: '/inventory'})).toEqual({path: '/inventory', query: ''});
    expect(readPageInput(undefined)).toBeNull();
    expect(readPageInput({path: 42})).toBeNull();
    expect(readPageInput({path: 'javascript:alert(1)'})).toBeNull();
    expect(readPageInput({path: '//evil.example/x'})).toBeNull();
    expect(readPageInput({path: '/' + 'a'.repeat(250)})).toBeNull();
    expect(readPageInput({path: '/inventory', query: 'x'.repeat(400)})).toEqual({path: '/inventory', query: ''});
  });
});

describe('dashboardLinks', () => {
  it('keeps same-host links only, at most 3', () => {
    const t = 'see https://coop.example.com/inventory?tab=all and http://evil.example/inventory and mailto:a@b.c ' +
      'https://coop.example.com/offline-sales https://coop.example.com/health https://coop.example.com/repricer';
    expect(dashboardLinks(t, 'coop.example.com')).toEqual(['/inventory?tab=all', '/offline-sales', '/health']);
    expect(dashboardLinks('no links here', 'coop.example.com')).toEqual([]);
  });
});

describe('pageContextLine', () => {
  it('describes the current page and pasted pages, or returns null', () => {
    const line = pageContextLine({path: '/inventory', query: 'tab=all'}, ['/offline-sales']);
    expect(line).toMatch(/^\[page\] The owner is on \/inventory\?tab=all \(Inventory:/);
    expect(line).toMatch(/pasted a link to \/offline-sales \(Offline sales:/);
    expect(line).toMatch(/pos_inventory_by_location/);
    expect(pageContextLine(null, [])).toBeNull();
    expect(pageContextLine({path: '/nope', query: ''}, [])).toBeNull();
  });
});

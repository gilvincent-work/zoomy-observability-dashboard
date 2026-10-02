import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {safeReason} from '../src/chat/server';

describe('safeReason: why the live path failed, without secrets', () => {
  it('keeps what Supabase answered', () => {
    expect(safeReason(new Error('orders read failed: Invalid API key'))).toBe('data load failed (Error): orders read failed: Invalid API key');
  });
  it('removes JWTs, keys and URLs, and caps the length', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiY29vcF9jaGF0X3JvIn0.c2lnbmF0dXJl';
    const out = safeReason(new Error(`bad token ${jwt} for https://abc.supabase.co/rest/v1/pos_orders?apikey=sk-ant-SECRET123 ${'x'.repeat(400)}`));
    expect(out).not.toMatch(/eyJ|supabase\.co|SECRET123/);
    expect(out).toContain('[token]');
    expect(out.length).toBeLessThanOrEqual(260);
  });
  it('falls back to the error name for an empty message and for a non-error', () => {
    expect(safeReason(new TypeError(''))).toBe('data load failed (TypeError)');
    expect(safeReason('boom')).toBe('data load failed (Error)');
  });
});

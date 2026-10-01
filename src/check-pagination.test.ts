import {describe, it, expect} from 'vitest';
import {scan} from '../scripts/check-pagination.mjs';

// Enforces the PostgREST db-max-rows (1000) hardening at `vitest run` time: any
// unbounded Supabase read (or a literal row limit > 1000) in src/ or scripts/
// fails here unless it is paginated via fetchAllRows or carries a documented
// "// pagination-ok: <reason>". See scripts/check-pagination.mjs.
describe('pagination guard', () => {
  it('finds no unbounded Supabase reads in src/ or scripts/', () => {
    const violations = scan();
    const report = violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.detail}`).join('\n');
    expect(violations, report && `\n${report}`).toHaveLength(0);
  });
});

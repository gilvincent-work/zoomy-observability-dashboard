// libpg-query (WASM) must stay an external server package: bundled, its .wasm is missing from the build and the Explore parser cannot start
// (found by `next build` on Day 6: "ENOENT .next/server/app/api/chat/libpg-query.wasm"). See next.config.mjs.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

describe('next.config', () => {
  it('keeps libpg-query out of the server bundle (serverExternalPackages)', () => {
    const src = readFileSync('next.config.mjs', 'utf8');
    expect(src).toMatch(/serverExternalPackages:\s*\[[^\]]*'libpg-query'/);
  });

  it('ships libpg-query.wasm with the chat route (outputFileTracingIncludes)', () => {
    const src = readFileSync('next.config.mjs', 'utf8');
    expect(src).toMatch(/outputFileTracingIncludes:\s*\{\s*'\/api\/chat':\s*\[[^\]]*libpg-query\/wasm\/\*\.wasm/);
  });
});

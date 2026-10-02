import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {CSP_DIRECTIVES, CSP_VALUE, headerRules} from '../security-headers.mjs';

describe('security headers', () => {
  it('sets exactly the four conservative CSP directives', () => {
    expect(CSP_DIRECTIVES.map((d) => d.split(' ')[0]).sort()).toEqual(['base-uri', 'frame-ancestors', 'img-src', 'object-src']);
    expect(CSP_VALUE).toContain("img-src 'self' data: blob:");
    expect(CSP_VALUE).toContain("object-src 'none'");
    expect(CSP_VALUE).toContain("base-uri 'self'");
    expect(CSP_VALUE).toContain("frame-ancestors 'none'");
  });

  it('allows no remote image host and sets no directive that could break scripts or styles', () => {
    expect(CSP_VALUE).not.toMatch(/https?:|\*/);
    expect(CSP_VALUE).not.toMatch(/default-src|script-src|style-src|connect-src|font-src/);
  });

  it('is applied to every route through next.config.mjs', () => {
    const rules = headerRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(rules[0].headers).toEqual([{key: 'Content-Security-Policy', value: CSP_VALUE}]);
    expect(readFileSync('next.config.mjs', 'utf8')).toMatch(/headers:\s*async\s*\(\)\s*=>\s*headerRules\(\)/);
  });

  it('the app really draws no remote image (otherwise img-src needs its host)', () => {
    // a cheap tripwire: no <img> element and no next/image import in components/ or app/ (comments aside)
    const walk = (dir: string): string[] =>
      readdirSync(dir, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = [...walk('components'), ...walk('app')].filter((f) => /<img[\s>]|next\/image/.test(code(f)));
    expect(hits).toEqual([]);
  });
});

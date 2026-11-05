import { useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { FLOOR_HREF } from './chatLinks';
import { copyText } from './clipboard';
import './chat.css';

// Agent-written prose (the CEO's texts and reasons, issues, QA reports) rendered as Markdown.
// Safe by default: raw HTML is shown as text, never parsed, and only http(s)/mailto links work.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** Turns raw HTML (`<script>`, `<img onerror>`, …) into plain text, so it's shown exactly as written. */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return walk;
}

const SAFE_LINK = /^(https?:|mailto:)/i;
const safeUrl = (url: string) => (SAFE_LINK.test(url.trim()) || FLOOR_HREF.test(url) ? url : '');

const Link = ({ href, children }: { href?: string; children?: ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span className="md-deadlink">{children}</span>
  );

/** A code block with a Copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () =>
    void copyText(ref.current?.innerText ?? '').then((ok) => {
      setCopied(ok);
      setTimeout(() => setCopied(null), 1500);
    });
  return (
    <div className="md-code">
      <pre ref={ref} tabIndex={0}>
        {children}
      </pre>
      <button type="button" className="md-copy" onClick={copy} aria-label="Copy the code">
        {copied === null ? '📋 Copy' : copied ? '✓ Copied' : "Couldn't copy"}
      </button>
    </div>
  );
}

const components: Components = {
  a: Link,
  // Images would load arbitrary URLs and blow up the layout; show them as links instead.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        🖼 {alt || src}
      </a>
    ) : (
      <span>🖼 {alt}</span>
    ),
  table: ({ children }) => (
    <div className="md-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  // Code blocks (and tables, above) scroll sideways: focusable, so the keyboard can scroll them too.
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

// remark-breaks keeps single line breaks, as the phone showed them before Markdown.
const remarkPlugins = [remarkGfm, remarkHtmlAsText, remarkBreaks];

/** `onFloor`: floor chips (ui/chatLinks.ts) are buttons that open the floor; without it they're plain text. */
export function Markdown({ text, className, onFloor }: { text: string; className?: string; onFloor?: (floor: number) => void }) {
  const withFloors = useMemo<Components>(
    () => ({
      ...components,
      a: (props) => {
        const floor = props.href?.match(FLOOR_HREF)?.[1];
        if (!floor) return <Link href={props.href}>{props.children}</Link>;
        return onFloor ? (
          <button type="button" className="floor-chip" onClick={() => onFloor(Number(floor))} title={`Open floor ${floor}`}>
            {props.children}
          </button>
        ) : (
          <span>{props.children}</span>
        );
      },
    }),
    [onFloor],
  );
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={withFloors} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

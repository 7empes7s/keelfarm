import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { FLOOR_HREF } from './chatLinks';
import { copyText } from './clipboard';
import { COLLAPSE_LINES, codeLanguage, codeTitle, copiedText, isShell, shellLines } from './codeBlock';
import './chat.css';
import { REF_HREF } from '../../../shared/chatRefs';
import { Icon } from './Icon';

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
const safeUrl = (url: string) => (SAFE_LINK.test(url.trim()) || FLOOR_HREF.test(url) || REF_HREF.test(url) ? url : '');

const Link = ({ href, children }: { href?: string; children?: ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span className="md-deadlink">{children}</span>
  );

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const hastText = (n: HastNode): string => n.value ?? n.children?.map(hastText).join('') ?? '';

const CopyGlyph = ({ done }: { done: boolean }) => (
  // Lucide's copy and check (ISC)
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {done ? <path d="M20 6 9 17l-5-5" /> : (
      <>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </>
    )}
  </svg>
);

/** A code block (#200): a header with its language and Copy above the code, shell commands wrapped after a `$`. */
function CodeBlock({ node }: { node?: HastNode }) {
  const code = node?.children?.find((c) => c.tagName === 'code');
  const lang = codeLanguage(code?.properties?.className);
  const raw = hastText(code ?? node ?? { type: 'text' }).replace(/\n+$/, '');
  const shell = isShell(lang);
  const lines = shell ? shellLines(raw) : raw.split('\n').map((text) => ({ text, prompt: false }));
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [edges, setEdges] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  // the sideways edge fade, where there's more to scroll to
  const fade = useCallback(() => {
    const el = pre.current;
    if (!el || shell) return;
    const more = el.scrollWidth - el.clientWidth;
    setEdges(`${el.scrollLeft > 1 ? 'l' : ''}${el.scrollLeft < more - 1 ? 'r' : ''}`);
  }, [shell]);
  useEffect(() => {
    const el = pre.current;
    if (!el || shell) return;
    fade();
    const watch = new ResizeObserver(fade);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fade, shell, open, raw]);
  const copy = () =>
    void copyText(copiedText(raw, lang)).then((ok) => {
      setCopied(ok);
      setTimeout(() => setCopied(null), 1500);
    });
  const long = lines.length > COLLAPSE_LINES;
  return (
    <div className={`md-code${shell ? ' md-code-shell' : ''}`}>
      <div className="md-code-head">
        <span className="md-code-lang">{codeTitle(lang, lines.length)}</span>
        <button type="button" className={`ds-btn ds-btn-ghost md-copy${copied === null ? ' ds-btn-icon' : ''}`} onClick={copy} aria-label={copied === null ? 'Copy the code' : copied ? 'Copied' : "Couldn't copy"}>
          <CopyGlyph done={copied === true} />
          {copied !== null && <span aria-live="polite">{copied ? 'Copied' : "Couldn't copy"}</span>}
        </button>
      </div>
      <pre ref={pre} tabIndex={0} onScroll={fade} data-fade={edges || undefined} className={long && !open ? 'md-code-folded' : undefined}>
        <code>
          {(long && !open ? lines.slice(0, COLLAPSE_LINES) : lines).map((l, i) => (
            <span key={i} className={l.prompt ? 'md-line md-line-cmd' : 'md-line'}>
              {l.text || '\n'}
            </span>
          ))}
        </code>
      </pre>
      {long && (
        <button type="button" className="ds-btn ds-btn-ghost md-code-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

const components: Components = {
  a: Link,
  // Images would load arbitrary URLs and blow up the layout; show them as links instead.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        <Icon name="image" /> {alt || src}
      </a>
    ) : (
      <span>
        <Icon name="image" /> {alt}
      </span>
    ),
  table: ({ children }) => (
    <div className="md-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  // Code blocks (and tables, above) scroll sideways: focusable, so the keyboard can scroll them too.
  pre: ({ node }) => <CodeBlock node={node as HastNode | undefined} />,
};

// remark-breaks keeps single line breaks, as the phone showed them before Markdown.
const remarkPlugins = [remarkGfm, remarkHtmlAsText, remarkBreaks];

/**
 * `onFloor`: floor chips (ui/chatLinks.ts) are buttons that open the floor; `renderRef`: the chat's ref chips
 * (shared/chatRefs.ts refsMarkdown), by index. Without them they're plain text.
 */
export function Markdown({ text, className, onFloor, renderRef }: { text: string; className?: string; onFloor?: (floor: number) => void; renderRef?: (index: number, children: ReactNode) => ReactNode }) {
  // The latest handlers, read when used: new ones each render mustn't remount the chips (and close their previews).
  const handlers = useRef({ onFloor, renderRef });
  handlers.current = { onFloor, renderRef };
  const hasFloor = !!onFloor;
  const hasRef = !!renderRef;
  const withFloors = useMemo<Components>(
    () => ({
      ...components,
      a: (props) => {
        const ref = props.href?.match(REF_HREF)?.[1];
        if (ref) return hasRef ? handlers.current.renderRef?.(Number(ref), props.children) : <span>{props.children}</span>;
        const floor = props.href?.match(FLOOR_HREF)?.[1];
        if (!floor) return <Link href={props.href}>{props.children}</Link>;
        return hasFloor ? (
          <button type="button" className="floor-chip" onClick={() => handlers.current.onFloor?.(Number(floor))} title={`Open floor ${floor}`}>
            {props.children}
          </button>
        ) : (
          <span>{props.children}</span>
        );
      },
    }),
    [hasFloor, hasRef],
  );
  // Parsed once per text (#145): a re-render with the same words (a keystroke in the chat's box) reuses the tree.
  const tree = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={remarkPlugins} components={withFloors} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    ),
    [text, withFloors],
  );
  return <div className={className ? `md ${className}` : 'md'}>{tree}</div>;
}

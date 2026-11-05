import { useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { FLOOR_HREF } from './chatLinks';
import { REF_HREF } from '../../../shared/chatRefs';

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
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
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
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={withFloors} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

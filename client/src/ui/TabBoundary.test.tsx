import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabBoundary } from './TabBoundary';

function Boom(): never {
  throw new Error('Maximum update depth exceeded');
}

// renderToStaticMarkup doesn't run error boundaries, so the boundary's two steps are driven by hand: the error it
// catches becomes its state, and its render then draws the fallback instead of the tab.
describe('a tab that throws (#351)', () => {
  it('shows "This tab couldn\'t load", the error and Retry, not a blank page', () => {
    const b = new TabBoundary({ children: <Boom /> });
    b.state = TabBoundary.getDerivedStateFromError(new Error('Maximum update depth exceeded'));
    const html = renderToStaticMarkup(<>{b.render()}</>);
    expect(html).toContain('This tab couldn&#x27;t load');
    expect(html).toContain('Maximum update depth exceeded');
    expect(html).toContain('Retry');
  });

  it('draws the tab itself while nothing has thrown', () => {
    const b = new TabBoundary({ children: <p>Setup</p> });
    expect(renderToStaticMarkup(<>{b.render()}</>)).toBe('<p>Setup</p>');
  });
});

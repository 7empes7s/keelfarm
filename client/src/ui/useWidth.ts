import { useLayoutEffect, useState } from 'react';

// An element's width in px, for SVG charts drawn at their real width (the chat's charts, Mission control's trends).

/** An element's width in px, measured as it changes (a callback ref: the plot appears once its data loads). */
export function useWidth(initial: number): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => el.clientWidth && setW(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

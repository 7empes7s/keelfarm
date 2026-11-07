// The office's icons (#134): `<Icon name=… />` draws one of ui/icons.ts's Lucide icons as inline SVG in the text's
// colour. Beside text it is 1.2em; an icon-only button sizes it iOS-style through --ds-icon (design.css). An icon is
// decoration (aria-hidden) unless it is given a label; an icon-only button carries the label itself.
import type { MouseEvent } from 'react';
import { ICONS, leadingIcon, type IconName } from './icons';

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  const Svg = ICONS[name];
  return (
    <Svg
      className={className ? `ds-icon ${className}` : 'ds-icon'}
      strokeWidth={2}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}

/** Text from shared/ or saved data that may start with an emoji ("⏳ 2 tasks waiting…"): that emoji drawn as its icon. */
export function IconText({ text }: { text: string }) {
  const t = leadingIcon(text);
  return t.icon ? (
    <>
      <Icon name={t.icon} /> {t.text}
    </>
  ) : (
    <>{text}</>
  );
}

/** The one ✕: a 44px close button with the x icon, for every panel, sheet, viewer, modal and the reply bar. */
export function CloseButton({
  onClick,
  label = 'Close',
  title,
  className,
}: {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  label?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button type="button" className={className ? `ds-close ${className}` : 'ds-close'} aria-label={label} title={title} onClick={onClick}>
      <Icon name="x" />
    </button>
  );
}

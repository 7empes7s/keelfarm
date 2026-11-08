// One key or token field that password managers leave alone (#264): a unique id and name, no autofill, and each
// manager's ignore attribute, so picking a saved login never fills the same secret into every key field on the page.
import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id' | 'name' | 'autoComplete'> & {
  /** Unique on the page, e.g. `cloud-anthropic-key`: becomes the field's id and name, prefixed `cubefarm-`. */
  name: string;
};

export function SecretInput({ name, ...rest }: Props) {
  return (
    <input
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      {...rest}
      type="password"
      id={`cubefarm-${name}`}
      name={`cubefarm-${name}`}
      // Chrome ignores "off" on password fields; "new-password" keeps it from filling a saved one.
      autoComplete="new-password"
      data-bwignore="true"
      data-1p-ignore="true"
      data-lpignore="true"
      data-form-type="other"
    />
  );
}

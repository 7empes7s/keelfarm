// The clipboard, for chat messages, artifacts and code blocks.

/** Copies text, also where the async clipboard isn't available (a phone on the office's plain-http address). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS Safari selects nothing with select() alone
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

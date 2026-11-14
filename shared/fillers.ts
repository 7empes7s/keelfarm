// Filler words on a call (#682, msg 4621): hesitation sounds never spoken by the voice nor shown, posted or sent as the
// manager's words, and the stutter of a restarted phrase ("this is, uh... this is supposed") kept once. Pure.

/** Hesitation sounds, as recognizers and models write them. */
const FILLER = /^(u+h+|u+m+|uhm+|e+r+|erm+|m+h*m+|h+m+|och+)$/;

const core = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const sentenceEnd = (w: string) => /[.!?]$/.test(w) && !/(\.\.\.|…)$/.test(w);
const capitalise = (s: string) => s.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** The words without fillers: the comma before one goes with it, a full stop after one moves to the word before. */
function dropFillers(text: string, well: boolean): string[] {
  const out: string[] = [];
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    const c = core(w);
    const atStart = !out.length || sentenceEnd(out[out.length - 1]);
    if (FILLER.test(c) || (well && atStart && c === 'well' && /[,…]|\.\.\.$/.test(w))) {
      if (out.length) {
        out[out.length - 1] = out[out.length - 1].replace(/,$/, '');
        if (sentenceEnd(w) && !sentenceEnd(out[out.length - 1])) out[out.length - 1] += w.slice(-1);
      }
      continue;
    }
    out.push(w);
  }
  return out;
}

/** A spoken line without filler words or a hesitant "Well…" opening a sentence. */
export function noFillers(text: string): string {
  const kept = dropFillers(text, true).join(' ');
  return kept === text.trim().split(/\s+/).join(' ') ? kept : capitalise(kept); // a streamed piece mid-sentence stays as it is
}

/** The manager's words as shown, posted and sent: no fillers, and a phrase said twice in a row (a restart) kept once. */
export function cleanHeard(text: string): string {
  const w = dropFillers(text, false);
  for (let changed = true; changed; ) {
    changed = false;
    for (let n = 4; n >= 1 && !changed; n--)
      for (let i = n; i + n <= w.length; i++) {
        const a = w.slice(i - n, i).map(core);
        const b = w.slice(i, i + n).map(core);
        if (a.every(Boolean) && a.join(' ') === b.join(' ')) {
          w.splice(i - n, n); // the restart's words stay
          changed = true;
          break;
        }
      }
  }
  const kept = w.join(' ');
  return kept === text.trim().split(/\s+/).join(' ') ? kept : capitalise(kept);
}

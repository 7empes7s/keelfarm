// One-tap ntfy (docs/pocket.md): a long random topic on ntfy.sh, and the links that subscribe to it in the ntfy app.
// The server makes the topic (notifier.ts); the settings show its links and QR code once, right after.

export const NTFY_SERVER = 'https://ntfy.sh';

/** Where to get the ntfy app. */
export const NTFY_APPS = {
  ios: 'https://apps.apple.com/app/ntfy/id1625396347',
  android: 'https://play.google.com/store/apps/details?id=io.heckel.ntfy',
};

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 letters and digits, none easily mistaken for another

/** A topic name nobody guesses: "cubefarm-" and 5 random bits per character from `bytes` (16 bytes: 25 characters, 125 bits). */
export function ntfyTopic(bytes: Uint8Array): string {
  if (bytes.length < 12) throw new Error('A topic needs at least 12 random bytes.');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return `cubefarm-${out}`;
}

/**
 * The ways to subscribe to a topic URL: `app` opens the ntfy app on the topic (ntfy://host/topic, what the QR code
 * holds), `web` the topic's page on its server, which also offers the apps.
 */
export function ntfyLinks(topicUrl: string): { topic: string; app: string; web: string } {
  const u = new URL(topicUrl);
  const topic = u.pathname.replace(/^\/|\/$/g, '');
  return { topic, app: `ntfy://${u.host}/${topic}`, web: `${u.origin}/${topic}` };
}

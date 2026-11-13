// The demo's keys end to end (#609): the manager pastes a key in chat and the demo CEO saves it in Providers
// (save_provider_key, the chat then shows "•••• (saved to Providers as …)"), installs it and the OpenAI key into
// clipfarm's env file (install_key: cards, the file in the demo's own home), and makes a narrow Cloudflare token
// (provider_action token_create). Install targets and the Cloudflare token API are faked in demo/cloudflare.ts and
// the IT desk's demo itExec.
import { registerCeoReply } from './registry.ts';

/** "client id:secret", as the manager would paste a Twitch app's pair. */
const PAIR = /\b([a-z0-9]{12,}):([a-z0-9]{12,})\b/i;
const DEMO_TWITCH = 'demotwitchclientid0001:demotwitchsecret00009z';

registerCeoReply('keys', async ({ text, use }) => {
  if (!/\b(twitch|install (the |a )?keys?|keys? (in|into) clipfarm|narrow (cloudflare )?token)\b/i.test(text)) return null;
  if (/narrow (cloudflare )?token/i.test(text)) {
    const card = await use('provider_action', { provider: 'cloudflare', op: 'token_create', args: { name: 'clipfarm DNS', permissions: ['DNS Write', 'Zone Read'], days: 90 }, why: 'clipfarm needs DNS edits only, not the full Cloudflare key.' });
    return card.startsWith('Refused') ? `I couldn't plan it: ${card.replace(/^Refused:\s*/, '')}` : 'A token with only DNS Write and Zone Read is on a card: tap Approve and the office makes it, keeps it in Providers and renews it 7 days before it expires.';
  }
  const value = text.match(PAIR)?.[0] ?? DEMO_TWITCH;
  const saved = await use('save_provider_key', { provider: 'twitch', value, label: 'Twitch (clipfarm)', uses: 'clipfarm watchlist' });
  if (saved.startsWith('Refused')) return `I couldn't save it: ${saved.replace(/^Refused:\s*/, '')}`;
  const target = '/etc/clipfarm/clipfarm.env';
  await use('install_key', { key: 'Twitch (clipfarm)', target, var_name: 'TWITCH_CLIENT_ID', part: 'id', why: "clipfarm's watchlist needs Twitch." });
  await use('install_key', { key: 'Twitch (clipfarm)', target, var_name: 'TWITCH_CLIENT_SECRET', part: 'secret', why: "clipfarm's watchlist needs Twitch." });
  await use('install_key', { key: 'OpenAI API', target, var_name: 'OPENAI_API_KEY', why: 'clipfarm transcribes with Whisper.' });
  return 'Saved the Twitch pair in Providers (the chat shows •••• where you pasted it). Installing TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and OPENAI_API_KEY into clipfarm is on cards: tap Approve and clipfarm restarts with them. No terminal step.';
}, { early: true });

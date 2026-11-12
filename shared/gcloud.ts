// Google Cloud (#622), pure: a service account's JSON (the "key" of the Google Cloud provider in Settings → Providers),
// the APIs the office may enable, and the Providers key an API key made from it is saved as. The private key stays in
// the JSON; only its id, the account's email and the project id are ever shown.

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string;
  projectId: string;
  tokenUri: string;
}

const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** The service account in a JSON key file, or why it isn't one (worded for the manager). */
export function parseServiceAccount(raw: string): ServiceAccount | string {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return "That isn't a service account's JSON key file.";
  }
  const s = (k: string) => (o && typeof o[k] === 'string' ? (o[k] as string) : '');
  if (s('type') !== 'service_account') return "That JSON isn't a service account key (its type isn't service_account).";
  if (!s('client_email') || !s('project_id') || !s('private_key').includes('PRIVATE KEY')) return 'That service account JSON is missing its client_email, project_id or private_key.';
  const tokenUri = s('token_uri') || TOKEN_URI;
  if (!/^https:\/\/[a-z0-9.-]+\.googleapis\.com\//.test(tokenUri)) return "That service account's token_uri isn't Google's.";
  return { clientEmail: s('client_email'), privateKey: s('private_key'), privateKeyId: s('private_key_id'), projectId: s('project_id'), tokenUri };
}

/** The APIs services_enable may turn on, and an API key may be restricted to. */
export const GCLOUD_SERVICES = ['youtube.googleapis.com', 'aiplatform.googleapis.com', 'apikeys.googleapis.com', 'serviceusage.googleapis.com'] as const;

/** The Providers entry an API key restricted to these APIs is saved as. */
export const apiKeyProvider = (apis: readonly string[]) => (apis.length === 1 && apis[0] === 'youtube.googleapis.com' ? 'youtube' : 'other-key');

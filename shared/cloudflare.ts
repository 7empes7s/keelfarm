// The Cloudflare office action (#586): a write IT or the CEO asked for, kept on its IT desk card until the manager's
// Approve. No secret here: the key is named by its Providers connection id and read on the server at apply time.

export const CF_OPS = ['tunnel_ingress_get', 'tunnel_ingress_add', 'dns_cname_ensure', 'access_app_ensure', 'access_service_token_ensure', 'token_scopes'] as const;

/** What an approved card does, with the ids found when it was planned. */
export type CfChange =
  | { op: 'tunnel_ingress_add'; keyId: string; accountId: string; tunnelId: string; tunnelName: string; hostname: string; service: string }
  | { op: 'dns_cname_ensure'; keyId: string; zoneId: string; hostname: string; target: string }
  | { op: 'access_app_ensure'; keyId: string; accountId: string; hostname: string; emails: string[]; bypass: string[] }
  | { op: 'access_service_token_ensure'; keyId: string; accountId: string; hostname: string; appId: string; name: string; duration?: string; envFile: string }; // #607: the secret goes only into envFile

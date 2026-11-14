// The shared mailboxes through Microsoft Graph (#668), with the office's own mail app (entra mail_app_ensure): a
// mailbox's inbox read, an email sent. Each call is refused before any network when the mailbox isn't one the app was
// set up for (Exchange's RBAC scope refuses it again on its side). The app's "client id:secret" goes only into
// http.ts's token form; nothing returned holds it.
import type { Incoming } from '../shared/comms.ts';
import type { MailCred, ProviderHttp } from './providerActions/types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';

class MailError extends Error {}

type GraphMsg = { id: string; conversationId?: string; subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; toRecipients?: { emailAddress?: { address?: string } }[]; receivedDateTime?: string; body?: { content?: string }; bodyPreview?: string; isRead?: boolean };

/** Why the app can't touch this mailbox, or null. */
const credRefusal = (cred: MailCred, mailbox: string) => (cred.mailboxes.includes(mailbox.toLowerCase()) ? null : `${mailbox} isn't one of the mailboxes the office's mail app was set up for (${cred.mailboxes.join(', ')}).`);

/** HTML mail as plain text, roughly. */
const plain = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

async function token(http: ProviderHttp, cred: MailCred): Promise<string> {
  const r = await http(`${cred.clientId}:${cred.secret}`, { method: 'POST', url: `https://login.microsoftonline.com/${cred.tenant}/oauth2/v2.0/token`, auth: 'entra-token', form: { grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' } });
  const t = (r.body as { access_token?: unknown } | undefined)?.access_token;
  if (r.status >= 400 || typeof t !== 'string') throw new MailError(r.status === 0 ? "Couldn't reach Microsoft." : 'The mail app was turned away: run provider_action entra mail_app_ensure again.');
  return t;
}

const why = (status: number, body: unknown) => {
  const e = (body as { error?: { message?: string } } | undefined)?.error?.message;
  return status === 403 ? `Exchange refused it (the mailbox is outside the mail app's scope)${e ? `: ${e}` : ''}.` : `Graph answered ${status}${e ? `: ${e}` : ''}.`;
};

/** A mailbox's newest inbox messages. */
export async function readInbox(http: ProviderHttp, cred: MailCred, mailbox: string, top = 25): Promise<Incoming[]> {
  const no = credRefusal(cred, mailbox);
  if (no) throw new MailError(no);
  const t = await token(http, cred);
  const r = await http(t, { method: 'GET', url: `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,body,isRead`, auth: 'bearer' });
  if (r.status !== 200) throw new MailError(why(r.status, r.body));
  return ((r.body as { value?: GraphMsg[] } | undefined)?.value ?? []).map((m) => ({
    id: m.id,
    threadId: m.conversationId ?? m.id,
    from: (m.from?.emailAddress?.address ?? '').toLowerCase(),
    ...(m.from?.emailAddress?.name && { fromName: m.from.emailAddress.name }),
    to: (m.toRecipients ?? []).map((x) => (x.emailAddress?.address ?? '').toLowerCase()).filter(Boolean),
    subject: m.subject ?? '',
    text: plain(m.body?.content ?? m.bodyPreview ?? ''),
    at: Date.parse(m.receivedDateTime ?? '') || Date.now(),
    read: !!m.isRead,
  }));
}

/** One email sent as the mailbox (a copy kept in its Sent Items). */
export async function sendAs(http: ProviderHttp, cred: MailCred, mailbox: string, m: { to: string[]; subject: string; text: string }): Promise<void> {
  const no = credRefusal(cred, mailbox);
  if (no) throw new MailError(no);
  const t = await token(http, cred);
  const r = await http(t, { method: 'POST', url: `${GRAPH}/users/${encodeURIComponent(mailbox)}/sendMail`, auth: 'bearer', body: { message: { subject: m.subject, body: { contentType: 'Text', content: m.text }, toRecipients: m.to.map((address) => ({ emailAddress: { address } })) }, saveToSentItems: true } });
  if (r.status >= 300 || r.status === 0) throw new MailError(r.status === 0 ? "Couldn't reach Microsoft." : why(r.status, r.body));
}

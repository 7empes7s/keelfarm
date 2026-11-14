// The demo's Exchange Online and Graph mail (#668), in memory, behind fakeProviderHttp: the admin API's cmdlets
// (mailboxes, Exchange service principals, management scopes, role assignments, DKIM), Graph's /domains (every tenant
// owns techinsiderbytes.com except one with "keel" in its id), an app's Graph role assignments, and mailbox reads and
// sends that Exchange's RBAC decides: an app reaches a mailbox only when its role assignment's scope filter names it.
// An admin app with "noexo" lacks Exchange.ManageAsApp. `world.sent` records every send.
import type { ActionRequest, ActionResponse } from '../providerActions/types.ts';

export interface TokenInfo {
  tenant: string;
  client: string;
}
type Box = { PrimarySmtpAddress: string; RecipientTypeDetails: string };
type Assignment = { Name: string; Role: string; App: string; CustomResourceScope: string };
type Msg = { id: string; conversationId: string; subject: string; from: { emailAddress: { address: string; name?: string } }; toRecipients: { emailAddress: { address: string } }[]; receivedDateTime: string; body: { content: string }; isRead: boolean };

const ok = (body: unknown, status = 200): ActionResponse => ({ status, body });
const denied = (message: string): ActionResponse => ({ status: 403, body: { error: { code: 'ErrorAccessDenied', message } } });

export function fakeExchange() {
  const world = {
    mailboxes: [{ PrimarySmtpAddress: 'maro@techinsiderbytes.com', RecipientTypeDetails: 'UserMailbox' }, { PrimarySmtpAddress: 'hello@techinsiderbytes.com', RecipientTypeDetails: 'SharedMailbox' }] as Box[],
    sps: [] as { AppId: string; ObjectId: string }[],
    scopes: [] as { Name: string; RecipientRestrictionFilter: string }[],
    assignments: [] as Assignment[],
    /** Tenant-wide Graph app role assignments, by service principal. */
    graphRoles: [] as { id: string; sp: string; resourceId: string; appRoleId: string }[],
    inbox: {} as Record<string, Msg[]>,
    sent: [] as { mailbox: string; to: string[]; subject: string; text: string }[],
    cmdlets: [] as string[],
    dkimOn: false,
  };
  let seq = 0;
  const inScope = (filter: string, mailbox: string) => filter.split(' -or ').some((p) => p === `PrimarySmtpAddress -eq '${mailbox}'`);
  /** RBAC for Applications: the app's assignment of this role over a scope naming the mailbox. */
  const may = (client: string, role: string, mailbox: string) => world.assignments.some((a) => a.App === client && a.Role === role && inScope(world.scopes.find((s) => s.Name === a.CustomResourceScope)?.RecipientRestrictionFilter ?? '', mailbox));

  const cmdlet = (key: string, name: string, p: Record<string, string>): ActionResponse => {
    if (/noexo/i.test(key)) return { status: 403, body: { error: { message: 'The role assigned to application isn’t supported in this scenario.' } } };
    world.cmdlets.push(name);
    switch (name) {
      case 'Get-Mailbox':
        return ok({ value: world.mailboxes.filter((b) => inScope(p.Filter ?? '', b.PrimarySmtpAddress)) });
      case 'New-Mailbox':
        world.mailboxes.push({ PrimarySmtpAddress: p.PrimarySmtpAddress, RecipientTypeDetails: 'SharedMailbox' });
        return ok({ value: [world.mailboxes.at(-1)] });
      case 'Get-ServicePrincipal':
        return ok({ value: world.sps });
      case 'New-ServicePrincipal':
        world.sps.push({ AppId: p.AppId, ObjectId: p.ObjectId });
        return ok({ value: [world.sps.at(-1)] });
      case 'Get-ManagementScope':
        return ok({ value: world.scopes });
      case 'New-ManagementScope':
        world.scopes.push({ Name: p.Name, RecipientRestrictionFilter: p.RecipientRestrictionFilter });
        return ok({ value: [world.scopes.at(-1)] });
      case 'Set-ManagementScope':
        Object.assign(world.scopes.find((s) => s.Name === p.Identity) ?? {}, { RecipientRestrictionFilter: p.RecipientRestrictionFilter });
        return ok({ value: [] });
      case 'Get-ManagementRoleAssignment':
        return ok({ value: world.assignments });
      case 'New-ManagementRoleAssignment':
        world.assignments.push({ Name: p.Name, Role: p.Role, App: p.App, CustomResourceScope: p.CustomResourceScope });
        return ok({ value: [world.assignments.at(-1)] });
      case 'Set-DkimSigningConfig':
        world.dkimOn = String(p.Enabled) === 'true';
        return ok({ value: [] });
      case 'Get-DkimSigningConfig':
        return ok({ value: [{ Domain: p.Identity, Selector1CNAME: `selector1-${p.Identity.replace(/\./g, '-')}._domainkey.techinsiderbytes.onmicrosoft.com`, Selector2CNAME: `selector2-${p.Identity.replace(/\./g, '-')}._domainkey.techinsiderbytes.onmicrosoft.com`, Enabled: world.dkimOn }] });
      default:
        return { status: 400, body: { error: { message: `No cmdlet ${name}` } } };
    }
  };

  /** A request this fake answers, else null. */
  function handle(key: string, req: ActionRequest, who: TokenInfo | undefined): ActionResponse | null {
    const exo = req.url.match(/^https:\/\/outlook\.office365\.com\/adminapi\/beta\/([^/]+)\/InvokeCommand$/);
    if (exo) {
      const input = (req.body as { CmdletInput: { CmdletName: string; Parameters: Record<string, string> } }).CmdletInput;
      return cmdlet(key, input.CmdletName, input.Parameters ?? {});
    }
    const p = req.url.replace('https://graph.microsoft.com/v1.0', '').split('?')[0];
    const domain = p.match(/^\/domains\/([^/]+)$/);
    if (domain) return who && !/keel/i.test(who.tenant) && decodeURIComponent(domain[1]) === 'techinsiderbytes.com' ? ok({ id: 'techinsiderbytes.com', isVerified: true }) : { status: 404, body: { error: { code: 'Request_ResourceNotFound' } } };
    const roles = p.match(/^\/servicePrincipals\/([^/]+)\/appRoleAssignments(?:\/([^/]+))?$/);
    if (roles) {
      if (req.method === 'DELETE') world.graphRoles = world.graphRoles.filter((r) => r.id !== roles[2]);
      return req.method === 'DELETE' ? ok(undefined, 204) : ok({ value: world.graphRoles.filter((r) => r.sp === roles[1]) });
    }
    const user = p.match(/^\/users\/([^/]+)\/(mailFolders\/inbox\/messages|sendMail)$/);
    if (!user) return null;
    const mailbox = decodeURIComponent(user[1]).toLowerCase();
    if (user[2] === 'sendMail') {
      if (!who || !may(who.client, 'Application Mail.Send', mailbox)) return denied('Access is denied. Check credentials and try again.');
      const m = (req.body as { message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] } }).message;
      world.sent.push({ mailbox, to: m.toRecipients.map((r) => r.emailAddress.address), subject: m.subject, text: m.body.content });
      return ok(undefined, 202);
    }
    if (!who || !may(who.client, 'Application Mail.ReadWrite', mailbox)) return denied('Access is denied. Check credentials and try again.');
    return ok({ value: world.inbox[mailbox] ?? [] });
  }

  /** A message arriving in a mailbox (tests and the demo). */
  const deliver = (mailbox: string, m: { from: string; name?: string; subject: string; text: string; conversation?: string; at?: number }) => {
    const id = `msg-${++seq}`;
    (world.inbox[mailbox] ??= []).push({ id, conversationId: m.conversation ?? `conv-${id}`, subject: m.subject, from: { emailAddress: { address: m.from, ...(m.name && { name: m.name }) } }, toRecipients: [{ emailAddress: { address: mailbox } }], receivedDateTime: new Date(m.at ?? Date.now()).toISOString(), body: { content: m.text }, isRead: false });
    return id;
  };
  return { world, handle, deliver };
}

# Comms: the shared mailboxes

The Comms floor's agents and the CEO read and answer email from the company's shared mailboxes on
techinsiderbytes.com (Exchange Online), and nothing goes out without the manager's Approve unless the manager
turns on a mailbox's auto-replies. The screen is Company → Comms.

## Setting it up (one card)

Ask the CEO to "set up mail for the shared mailboxes". It runs `provider_action entra mail_app_ensure` with the
admin app credential from Settings → Providers → Microsoft Entra, and the manager gets one card that lists every
change. On Approve the office:

1. Checks that the connection's tenant owns the domain (`techinsiderbytes.com` by default). A tenant that doesn't (KEEL's)
   is skipped: the office only reads its token and the domain lookup, and writes nothing there.
2. Registers the Entra app **cubefarm Mail** (single tenant) and its enterprise app. It gets **no tenant-wide Graph
   mail permission**. If one was granted by hand, the card removes it, because it would reach every mailbox.
3. Creates the shared mailboxes that are missing (`hello@`, `sales@`, `support@` by default; the names are the call's
   `mailboxes`). An address that is a person's mailbox is refused.
4. In Exchange Online ([RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)):
   - `New-ServicePrincipal` for the app,
   - the management scope **cubefarm shared mailboxes**, with the filter
     `PrimarySmtpAddress -eq 'hello@…' -or PrimarySmtpAddress -eq 'sales@…' -or …` and nothing else,
   - the role assignments **cubefarm mail send** (`Application Mail.Send`) and **cubefarm mail readwrite**
     (`Application Mail.ReadWrite`), both limited to that scope.
5. Adds a client secret that lasts 24 months. It goes straight into the office's secrets file and is never shown in
   a card, log, chat or tool result. The office renews it 30 days before it expires and then removes the old one.
6. Reads the domain's DKIM selectors (`Get-DkimSigningConfig`) for the DNS check.

Exchange's cmdlets run through its admin API with the same admin app. That app needs `Exchange.ManageAsApp` and the
Exchange Administrator role, plus `Application.ReadWrite.All` and `Domain.Read.All` in Graph. Run it again with other
`mailboxes` to change the list: the scope's filter is rewritten to exactly the new list.

The office checks the mailbox itself before every call, and Exchange's scope checks it again. A send or read as any
other mailbox is refused twice.

## Mail tools

The CEO and the agents on the floors ticked under Comms → Settings ("Floors with the mail tools") get:

| Tool | What it does |
| --- | --- |
| `mail_list` | threads per mailbox (unread, label), drafts waiting, today's outreach |
| `mail_read` | one thread's messages |
| `mail_draft` | a reply (`reply_to`) or a new email (`to`, `subject`), from a template, with the mailbox's signature; `channel` social/newsletter queues a post |
| `mail_send` | puts the draft on the manager's card; sends at once only for a reply from a mailbox with auto-replies on |
| `lead_update` | the lead list: name, company, source, stage, next step |

The inboxes are read every 5 minutes. A new email to sales@ joins the lead list.

## Outreach rules

- Every new email (outreach) ends with an unsubscribe line (`mailto:<mailbox>?subject=unsubscribe`). A draft without
  it can't be sent.
- Anyone who replies "unsubscribe" or "stop" goes on the suppression list. No outreach reaches them again, but
  replies to their own messages still work.
- Warm-up: 20 outreach emails a day in the first week, doubling each week up to the cap in Settings (200 by default).
- No purchased lists: outreach goes only to leads the floors found themselves or the agency's opportunities.

## Deliverability

`provider_action cloudflare mail_dns_check` checks SPF (`include:spf.protection.outlook.com`), DMARC and the two DKIM
selector CNAMEs. `mail_dns_ensure` puts the fixes on one card. It keeps the other senders already in SPF, adds DMARC
with `p=none` and reports sent to the first mailbox, and points the DKIM CNAMEs at Exchange. Running
`mail_app_ensure` again once they resolve turns DKIM signing on (`Set-DkimSigningConfig -Enabled`).

## Revoking it

Any one of these steps stops the office's mail access. Do all of them to remove it completely:

1. Exchange Online PowerShell:
   ```powershell
   Remove-ManagementRoleAssignment "cubefarm mail send"
   Remove-ManagementRoleAssignment "cubefarm mail readwrite"
   Remove-ManagementScope "cubefarm shared mailboxes"
   Remove-ServicePrincipal -Identity <the app's id>
   ```
2. Entra admin centre → App registrations → **cubefarm Mail** → Delete (or delete only its client secret).
3. In the office, remove `mailApp` from `secrets.json` in the office's home folder.

The shared mailboxes and their mail stay. Delete them in the Exchange admin centre if they're no longer wanted.

# Agency

Market research and business plans: what to build or sell next. An agency writes documents: QA checks sources and sums, and every external action waits for your approval.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Sonnet | Reads sources and writes plans well, without Opus prices. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 1 agent to start.
- **Preview:** not needed.
- **Test lab:** not needed; QA reads the documents.

## How it works

1. **Scout:** every day the floor asks the Researcher for a market scan. The CEO files an issue per opportunity; an agent writes `opportunities/<slug>.md` (problem, who pays, market size, competitors and prices, what we offer, our edge, effort, risks, expected revenue per month with assumptions, sources).
2. **Score:** the CEO registers each one's numbers (`agency_opportunities`). The office ranks them by expected monthly profit × confidence ÷ (effort days + days to the first dollar), and the top 3 come to you with Approve / Not now, in the chat and on the Company page.
3. **Plan:** an approved opportunity gets a `Plan:` issue, written to `plans/<slug>.md`. Route **build**: the CEO opens a new floor for it (`create_floor`) and files its issues. Route **ops**: outreach, listings and gigs.
4. **External actions:** posts, emails, sign-ups and gig proposals are drafted and wait on a card for your Approve. Nothing goes out by itself.
5. **Earnings:** a live opportunity's last 30 days come from its build floor's earnings, or from earnings entries that name it.

## QA brief

The floor's setup card adds these when they are missing:

- Every section is filled in, no placeholders
- Each claim and price has a source link
- Revenue estimates show their numbers and assumptions
- Nothing posted, sent or signed up for without the manager’s approval

See [all guides](README.md).

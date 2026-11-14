// The demo's Agency floor (#667): an opportunity issue, three scored opportunities (one approved with an ops plan, the
// best new ones shortlisted to the manager) and a gig proposal waiting for Approve.
import type { ActionInput, OpportunityInput } from '../shared/agency.ts';

export function agencySample(now: number) {
  const opportunities: OpportunityInput[] = [
    { slug: 'landing-page-audits', title: 'AI landing-page audits for small SaaS', revenue_month: 2400, cost_month: 150, effort_days: 4, days_to_first_dollar: 10, confidence: 0.6 },
    { slug: 'shopify-store-setup', title: 'Shopify store setup gigs', revenue_month: 1800, cost_month: 60, effort_days: 2, days_to_first_dollar: 7, confidence: 0.7 },
    { slug: 'changelog-widget', title: 'Hosted changelog widget', revenue_month: 900, cost_month: 40, effort_days: 12, days_to_first_dollar: 30, confidence: 0.4 },
  ];
  const action: ActionInput = {
    opportunity: 'shopify-store-setup',
    kind: 'proposal',
    target: 'Upwork: "Set up a Shopify store for a candle brand"',
    summary: 'A $450 fixed-price proposal for a store setup we can deliver in 3 days',
    draft: 'Hi! We set up Shopify stores end to end: theme, products, payments and shipping. For your candle brand: a clean theme, your 20 products with photos, and checkout tested, in 3 days for $450.',
  };
  return {
    opportunities,
    approved: 'shopify-store-setup',
    action,
    opportunityIssue: {
      title: 'Opportunity: AI landing-page audits for small SaaS',
      body: `Write opportunities/landing-page-audits.md from today's scout brief (${new Date(now).toISOString().slice(0, 10)}): problem, who pays, market size, competitors and prices, what we offer, our edge, effort, risks, expected revenue per month with assumptions, sources.`,
    },
  };
}

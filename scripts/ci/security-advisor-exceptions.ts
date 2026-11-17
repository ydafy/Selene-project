// Security advisor findings the maintainer accepted, keyed by the advisor's
// `cacheKey`, each with its reason. scripts/ci/check-security-advisors.ts fails
// on any other WARN or ERROR finding and on an entry no finding matches.
// Add an entry only with the maintainer's decision; remove it when the issue
// that fixes it merges (docs/maintenance.md, "Accepted findings").
export const ACCEPTED_SECURITY_FINDINGS: Record<string, string> = {
  security_definer_view_public_products_public:
    'Decided 2026-11-11 (docs/decision-log.md, "products_public Stays a SECURITY DEFINER View"): the view lists only the columns a buyer needs; security_invoker would need a row policy on products that shows the hidden columns of public listings to every signed-in user.',
};

// Which version of assigned material a learner gets first, from their accessibility profile.
export function formatFor(profile) {
  const needs = profile?.needs || [];
  if (needs.includes('blind') || needs.includes('low-vision')) return 'listen';
  if (needs.includes('deaf') || needs.includes('hard-of-hearing')) return 'see';
  return 'standard';
}

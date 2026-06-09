// Fuzzy Gmail sender-query builder.
//
// The naive query `from:vault.bitwarden.com OR from:@vault.bitwarden.com` only
// matches when the OTP email's sending domain is byte-identical to the site's
// hostname. In practice they rarely are: a user signs in at vault.bitwarden.com
// but the code arrives from no-reply@bitwarden.com; logins at app.example.com
// get mail from email.example.com; and so on. This builder widens the net by
// also matching the registrable ("base") domain and the bare brand token, so a
// subdomain mismatch no longer requires a manual override.

// Common multi-label public suffixes. Not a full Public Suffix List — just the
// ones likely to show up for consumer logins — so we don't mistake "co.uk" for
// the registrable domain and search "from:co" (matching everything).
const COMPOUND_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'co.jp', 'co.kr', 'co.in', 'co.za',
  'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.hk', 'com.cn'
]);

// Brand tokens shorter than this are too noisy to search on their own (e.g.
// "id", "my", "go"), so we drop the bare-brand term for them and rely on the
// base-domain match.
const MIN_BRAND_LENGTH = 3;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Strip a leading "www." and lowercase. */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

/**
 * Reduce a hostname to its registrable domain — the brand + public suffix.
 *   vault.bitwarden.com   -> bitwarden.com
 *   email.example.co.uk   -> example.co.uk
 *   bitwarden.com         -> bitwarden.com
 */
export function getRegistrableDomain(hostname: string): string {
  const host = normalizeHostname(hostname);
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join('.');
  if (COMPOUND_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

/** The brand label of a hostname: "bitwarden" from "vault.bitwarden.com". */
function getBrandToken(hostname: string): string {
  const registrable = getRegistrableDomain(hostname);
  return registrable.split('.')[0] ?? '';
}

/**
 * Build the `from:` portion of a Gmail search for OTP emails related to
 * `hostname`. Returns a parenthesized OR group such as:
 *
 *   (from:bitwarden.com OR from:bitwarden)
 *
 * Callers append their own time window, e.g. ` newer_than:30m`. Gmail's `from:`
 * matches substrings of both the sender address and display name, so the
 * base-domain term already covers any subdomain sender and the brand term
 * catches display-name-only or look-alike sending domains.
 */
export function buildSenderQuery(hostname: string): string {
  const host = normalizeHostname(hostname);

  // IPs and bare/invalid hosts: fall back to the literal exact match.
  if (!host || IPV4.test(host) || !host.includes('.')) {
    return `(from:${host} OR from:@${host})`;
  }

  const base = getRegistrableDomain(host);
  const brand = getBrandToken(host);

  const terms = [`from:${base}`];
  // Add the exact subdomain host when it differs from the base, so an exact
  // sender still ranks/returns even if the brand term is dropped.
  if (host !== base) terms.push(`from:${host}`);
  if (brand.length >= MIN_BRAND_LENGTH) terms.push(`from:${brand}`);

  return `(${terms.join(' OR ')})`;
}

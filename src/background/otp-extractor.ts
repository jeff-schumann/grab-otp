// Proximity-scoring OTP extractor.
//
// Replaces first-match regex scanning, which returned the first number in an
// email regardless of context — frequently an order number, price, or year
// rather than the actual code. Here we gather every plausible candidate and
// score it by:
//   - proximity to OTP-related keywords ("verification code", "otp", ...)
//   - code length (6 digits strongly preferred, then 8/7/5/4)
//   - negative context (preceded by #, $, "order", a year, a street address,
//     or sitting in the unsubscribe footer)
// and return the highest scorer. A labeled code beats an unlabeled number even
// when the unlabeled number appears first in the message.
//
// A candidate must carry a nearby keyword to be accepted at all. Without that
// floor, length alone scored above zero, so *any* number in the email was a
// valid answer — mailing addresses, zips, and phone numbers in footers were
// routinely returned as codes. The one exception is the short-email valve at
// the bottom of this file.
//
// Codes are not always numeric ("ATVAOGXLPR"), so letter-bearing candidates are
// collected too. Letters alone cannot be distinguished from prose by shape —
// over a third of ordinary dictionary words pass any vowel/consonant test — so
// an all-letter candidate must instead be *isolated*: alone on its line, or the
// sole token after a label's colon. That is how OTP emails present codes, and
// it is what keeps capitalized prose from qualifying.

interface Candidate {
  value: string; // the code as it should be filled
  start: number; // index of first character in the text
  end: number; // index just past the last character
  numeric: boolean; // digits only — eligible for the short-email valve
}

interface KeywordWeight {
  pattern: RegExp; // global + case-insensitive
  weight: number;
}

// Higher weight = stronger signal that a nearby candidate is the OTP.
const KEYWORDS: KeywordWeight[] = [
  { pattern: /one[\s-]?time (?:pass)?code/gi, weight: 12 },
  { pattern: /verification code/gi, weight: 12 },
  { pattern: /security code/gi, weight: 12 },
  { pattern: /authentication code/gi, weight: 11 },
  { pattern: /one[\s-]?time pin/gi, weight: 11 },
  { pattern: /passcode/gi, weight: 10 },
  { pattern: /\botp\b/gi, weight: 10 },
  { pattern: /access code/gi, weight: 9 },
  { pattern: /\b2fa\b/gi, weight: 9 },
  { pattern: /verification/gi, weight: 7 },
  { pattern: /to (?:verify|confirm|authenticate)/gi, weight: 6 },
  { pattern: /\bcode\b/gi, weight: 6 },
  { pattern: /\bpin\b/gi, weight: 6 }
];

// Markers immediately before a candidate that suggest it is NOT an OTP.
const NEGATIVE_PREFIX =
  /(?:[#$£€]|order|invoice|ref(?:erence)?|account|acct|phone|tel|fax|ext|zip|amount|total|qty|quantity|item|po box|suite|ste|unit|apt|floor|fl)\s*[#:.]?\s*$/i;

// A street suffix just after a number means the number is a street address.
const STREET_SUFFIX =
  /^[\s,]*(?:[NSEW]{1,2}\.?[\s,]+)?(?:[A-Za-z.'-]+[\s,]+){0,3}(?:hwy|highway|st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place|pkwy|parkway|sq|square|ter|terrace|cir|circle)\b/i;

// A two-letter state abbreviation just before a 5-digit number means it's a zip.
const STATE_BEFORE_ZIP = /\b[A-Z]{2}[\s,]+$/;

// Where the boilerplate footer begins. Candidates past this point are suspect.
const FOOTER_MARKERS =
  /unsubscribe|all rights reserved|privacy policy|terms of (?:use|service)|view (?:this|it) (?:email )?in your browser|do not reply|©|\(c\)\s*\d{4}/i;

// Isolated all-letter runs that are words rather than codes. Short by design:
// isolation already rejects prose, so this only covers one-word lines.
const ISOLATED_WORD_STOPLIST = new Set([
  'VERIFY', 'CONFIRM', 'THANKS', 'HELLO', 'WELCOME', 'SUPPORT', 'PRIVACY',
  'POLICY', 'SECURITY', 'ACCOUNT', 'PASSWORD', 'CONTINUE', 'SUBMIT', 'CANCEL',
  'SETTINGS', 'SINCERELY', 'REGARDS', 'WARNING', 'IMPORTANT', 'NOTE'
]);

// How many characters away a keyword can sit and still count, and the falloff.
const PROXIMITY_WINDOW = 40;
const NEGATIVE_LOOKBACK = 16;
const STREET_LOOKAHEAD = 40;

// Short-email valve: an email no longer than this, holding exactly one numeric
// candidate, may return that candidate without a keyword. Covers bodies that
// are little more than the code itself.
const SHORT_EMAIL_LENGTH = 200;

function buildCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Standalone runs of 4-8 digits. Word boundaries exclude longer runs such as
  // 10-digit phone numbers (no boundary exists inside a digit string).
  const standalone = /\b\d{4,8}\b/g;
  for (let m = standalone.exec(text); m; m = standalone.exec(text)) {
    candidates.push({ value: m[0], start: m.index, end: m.index + m[0].length, numeric: true });
  }

  // Grouped 3-3 codes ("123 456", "123-456") that standalone scanning misses.
  const grouped = /\b(\d{3})[\s-](\d{3})\b/g;
  for (let m = grouped.exec(text); m; m = grouped.exec(text)) {
    candidates.push({
      value: m[1] + m[2],
      start: m.index,
      end: m.index + m[0].length,
      numeric: true
    });
  }

  // Mixed letters and digits ("A1B2C3", "XK4F9Q"). Ordinary words never mix the
  // two, so these need no isolation check — any case is accepted.
  const mixed =
    /\b(?=[A-Za-z0-9]{4,10}\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,10}\b/g;
  for (let m = mixed.exec(text); m; m = mixed.exec(text)) {
    candidates.push({ value: m[0], start: m.index, end: m.index + m[0].length, numeric: false });
  }

  // All-letter codes ("ATVAOGXLPR"). Uppercase and isolated only — see the file
  // header for why shape tests cannot carry this.
  const letters = /\b[A-Z]{4,10}\b/g;
  for (let m = letters.exec(text); m; m = letters.exec(text)) {
    if (ISOLATED_WORD_STOPLIST.has(m[0])) continue;
    if (isKeywordWord(m[0])) continue;
    if (!isIsolated(text, m.index, m.index + m[0].length)) continue;
    candidates.push({ value: m[0], start: m.index, end: m.index + m[0].length, numeric: false });
  }

  return dedupe(candidates);
}

/**
 * True when the run is itself an OTP keyword ("CODE", "PASSCODE"). A label
 * repeated in caps on its own line is a heading, not the code it introduces.
 */
function isKeywordWord(value: string): boolean {
  return KEYWORDS.some(({ pattern }) => {
    const anchored = new RegExp(`^(?:${pattern.source})$`, 'i');
    return anchored.test(value);
  });
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.start}:${candidate.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * True when the span is presented on its own rather than inside a sentence:
 * alone on its line, or the only thing following a label's colon. Trailing
 * punctuation is ignored so "ATVAOGXLPR." still counts.
 */
function isIsolated(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start);
  const after = text.slice(end);

  const lineBefore = before.slice(before.lastIndexOf('\n') + 1).trim();
  const newlineAfter = after.indexOf('\n');
  const lineAfter = (newlineAfter === -1 ? after : after.slice(0, newlineAfter))
    .replace(/^[\s.,;!)\]]+/, '')
    .trim();

  if (lineBefore === '' && lineAfter === '') return true;

  // "Your code is: ATVAOGXLPR" — label ends in a colon, nothing follows.
  return /[:=]\s*$/.test(lineBefore) && lineAfter === '';
}

function keywordHits(text: string): Array<{ start: number; end: number; weight: number }> {
  const hits: Array<{ start: number; end: number; weight: number }> = [];
  for (const { pattern, weight } of KEYWORDS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      hits.push({ start: m.index, end: m.index + m[0].length, weight });
      if (m.index === pattern.lastIndex) pattern.lastIndex += 1; // guard against zero-width
    }
  }
  return hits;
}

function lengthScore(candidate: Candidate): number {
  if (!candidate.numeric) return 3; // letter-bearing codes vary too much to rank
  switch (candidate.value.length) {
    case 6:
      return 4;
    case 8:
      return 2;
    case 7:
    case 5:
    case 4:
      return 1;
    default:
      return 0;
  }
}

function proximityScore(
  candidate: Candidate,
  hits: Array<{ start: number; end: number; weight: number }>
): number {
  let best = 0;
  for (const hit of hits) {
    // A candidate that *is* the keyword ("CODE" on its own line) is not a code.
    if (hit.start < candidate.end && candidate.start < hit.end) continue;

    // Gap between the keyword and the candidate, whichever side it's on.
    const gap =
      hit.end <= candidate.start
        ? candidate.start - hit.end // keyword before candidate
        : hit.start - candidate.end; // keyword after candidate
    if (gap <= PROXIMITY_WINDOW) {
      best = Math.max(best, hit.weight * (1 - gap / PROXIMITY_WINDOW));
    }
  }
  return best;
}

function negativeScore(candidate: Candidate, text: string, footerStart: number): number {
  let penalty = 0;

  const before = text.slice(Math.max(0, candidate.start - NEGATIVE_LOOKBACK), candidate.start);
  if (NEGATIVE_PREFIX.test(before)) penalty -= 6;

  // Street addresses: "11575 SW Pacific Hwy".
  if (candidate.numeric && STREET_SUFFIX.test(text.slice(candidate.end, candidate.end + STREET_LOOKAHEAD))) {
    penalty -= 8;
  }

  // US zips: "Tigard, OR 97223".
  if (candidate.numeric && candidate.value.length === 5 && STATE_BEFORE_ZIP.test(before)) {
    penalty -= 8;
  }

  // Anything in the unsubscribe footer is boilerplate, not a code.
  if (footerStart !== -1 && candidate.start > footerStart) penalty -= 8;

  // A bare 4-digit number in the year range is usually a year, not a code.
  if (candidate.numeric && candidate.value.length === 4) {
    const n = Number(candidate.value);
    if (n >= 1900 && n <= 2099) penalty -= 3;
  }

  return penalty;
}

/**
 * Returns the best OTP candidate found in `text`, or null when nothing in the
 * message is labeled as a code. `text` should already be plain text (HTML
 * stripped) — combine the subject, Gmail snippet, and decoded body before
 * calling. Line breaks matter: they are what mark an isolated code.
 */
export function extractOtpFromText(text: string): string | null {
  if (!text) return null;

  const candidates = buildCandidates(text);
  if (candidates.length === 0) return null;

  const hits = keywordHits(text);
  const footerMatch = FOOTER_MARKERS.exec(text);
  const footerStart = footerMatch ? footerMatch.index : -1;

  // The valve: a body that is barely more than the code itself, holding a
  // single numeric candidate, is allowed through without a keyword.
  const isShort = text.trim().length <= SHORT_EMAIL_LENGTH;
  const lone = candidates.length === 1 ? candidates[0] : null;

  let bestValue: string | null = null;
  let bestScore = 0;
  let bestStart = Infinity;

  for (const candidate of candidates) {
    const proximity = proximityScore(candidate, hits);
    const context = lengthScore(candidate) + negativeScore(candidate, text, footerStart);

    // Label required, except for the lone candidate in a short email — and even
    // then only when nothing else argues against it (a year, a footer, a #).
    const labeled = proximity > 0;
    const valveApplies = !labeled && isShort && candidate === lone && candidate.numeric;
    if (!labeled && !(valveApplies && context > 0)) continue;

    const score = context + proximity;
    if (score <= 0) continue;

    // Strictly-greater keeps the earliest candidate on ties (subject and snippet
    // text, which callers prepend, sort first and are usually most relevant).
    if (score > bestScore || (score === bestScore && candidate.start < bestStart)) {
      bestValue = candidate.value;
      bestScore = score;
      bestStart = candidate.start;
    }
  }

  return bestValue;
}

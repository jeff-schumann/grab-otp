// Proximity-scoring OTP extractor.
//
// Replaces first-match regex scanning, which returned the first number in an
// email regardless of context — frequently an order number, price, or year
// rather than the actual code. Here we gather every plausible numeric
// candidate and score it by:
//   - proximity to OTP-related keywords ("verification code", "otp", ...)
//   - code length (6 digits strongly preferred, then 8/7/5/4)
//   - negative context (preceded by #, $, "order", "invoice", a year, ...)
// and return the highest scorer. A labeled code beats an unlabeled number even
// when the unlabeled number appears first in the message.

interface Candidate {
  value: string; // normalized digits, length 4-8
  start: number; // index of first digit in the text
  end: number; // index just past the last digit
}

interface KeywordWeight {
  pattern: RegExp; // global + case-insensitive
  weight: number;
}

// Higher weight = stronger signal that a nearby number is the OTP.
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

// Markers immediately before a number that suggest it is NOT an OTP.
const NEGATIVE_PREFIX =
  /(?:[#$£€]|order|invoice|ref(?:erence)?|account|acct|phone|tel|fax|zip|amount|total|qty|quantity|item)\s*[#:.]?\s*$/i;

// How many characters away a keyword can sit and still count, and the falloff.
const PROXIMITY_WINDOW = 40;
const NEGATIVE_LOOKBACK = 16;

function buildCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Standalone runs of 4-8 digits. Word boundaries exclude longer runs such as
  // 10-digit phone numbers (no boundary exists inside a digit string).
  const standalone = /\b\d{4,8}\b/g;
  for (let m = standalone.exec(text); m; m = standalone.exec(text)) {
    candidates.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }

  // Grouped 3-3 codes ("123 456", "123-456") that standalone scanning misses.
  const grouped = /\b(\d{3})[\s-](\d{3})\b/g;
  for (let m = grouped.exec(text); m; m = grouped.exec(text)) {
    candidates.push({ value: m[1] + m[2], start: m.index, end: m.index + m[0].length });
  }

  return candidates;
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

function lengthScore(len: number): number {
  switch (len) {
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
    // Gap between the keyword and the candidate, whichever side it's on.
    const gap =
      hit.end <= candidate.start
        ? candidate.start - hit.end // keyword before number
        : candidate.end <= hit.start
          ? hit.start - candidate.end // keyword after number
          : 0; // overlapping
    if (gap <= PROXIMITY_WINDOW) {
      best = Math.max(best, hit.weight * (1 - gap / PROXIMITY_WINDOW));
    }
  }
  return best;
}

function negativeScore(candidate: Candidate, text: string): number {
  let penalty = 0;

  const before = text.slice(Math.max(0, candidate.start - NEGATIVE_LOOKBACK), candidate.start);
  if (NEGATIVE_PREFIX.test(before)) penalty -= 6;

  // A bare 4-digit number in the year range is usually a year, not a code.
  if (candidate.value.length === 4) {
    const n = Number(candidate.value);
    if (n >= 1900 && n <= 2099) penalty -= 3;
  }

  return penalty;
}

/**
 * Returns the best OTP candidate found in `text`, or null if none scores above
 * zero. `text` should already be plain text (HTML stripped) — combine the Gmail
 * snippet and decoded body before calling.
 */
export function extractOtpFromText(text: string): string | null {
  if (!text) return null;

  const lower = text.toLowerCase();
  const candidates = buildCandidates(lower);
  if (candidates.length === 0) return null;

  const hits = keywordHits(lower);

  let bestValue: string | null = null;
  let bestScore = 0;
  let bestStart = Infinity;

  for (const candidate of candidates) {
    const score =
      lengthScore(candidate.value.length) +
      proximityScore(candidate, hits) +
      negativeScore(candidate, lower);

    // Strictly-greater keeps the earliest candidate on ties (snippet text, which
    // callers prepend, sorts first and is usually the most relevant line).
    if (score > bestScore || (score === bestScore && candidate.start < bestStart)) {
      if (score > 0) {
        bestValue = candidate.value;
        bestScore = score;
        bestStart = candidate.start;
      }
    }
  }

  return bestValue;
}

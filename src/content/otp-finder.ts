// Shared OTP field detection + filling logic used by both the Chrome and
// Firefox bridge content scripts.
//
// Strategy: instead of filling the first visible text input (which can land
// the code in an email/search box that happens to appear earlier in the DOM),
// we score every editable input by how "OTP-like" it is and fill the best
// candidate. Segmented inputs (one box per digit) are detected and filled
// digit-by-digit.

type Logger = (message: string) => void;

// Signals that an input is meant for a one-time code.
const POSITIVE_KEYWORDS = [
  'otp', 'one-time', 'onetime', 'one time', 'code', 'verification',
  'verify', 'token', 'passcode', 'pin', '2fa', 'mfa', 'sms', 'totp'
];

// Signals that an input is NOT an OTP field (avoid filling these).
const NEGATIVE_KEYWORDS = [
  'email', 'e-mail', 'password', 'passwd', 'search', 'username',
  'user-name', 'firstname', 'first-name', 'lastname', 'last-name',
  'phone', 'mobile', 'address', 'card', 'cvv', 'cvc', 'zip', 'postal',
  'fullname', 'full-name', 'query', 'coupon', 'promo'
];

// Input types that can never be an OTP field.
const EXCLUDED_TYPES = new Set([
  'password', 'email', 'hidden', 'checkbox', 'radio', 'submit',
  'button', 'file', 'search', 'color', 'range', 'date', 'datetime-local',
  'month', 'time', 'week', 'url'
]);

function isFillable(input: HTMLInputElement): boolean {
  const visible = input.offsetParent !== null || input.getClientRects().length > 0;
  return visible && !input.disabled && !input.readOnly;
}

function attr(input: HTMLInputElement, name: string): string {
  return (input.getAttribute(name) || '').toLowerCase();
}

// Higher score = more likely to be the OTP field. Returns -Infinity for
// inputs that must never be filled.
function scoreInput(input: HTMLInputElement): number {
  const type = attr(input, 'type');
  if (EXCLUDED_TYPES.has(type)) {
    return -Infinity;
  }

  const haystack = [
    attr(input, 'name'),
    attr(input, 'id'),
    attr(input, 'placeholder'),
    attr(input, 'aria-label'),
    attr(input, 'autocomplete'),
    input.className.toLowerCase()
  ].join(' ');

  let score = 0;

  if (attr(input, 'autocomplete') === 'one-time-code') {
    score += 100;
  }
  if (POSITIVE_KEYWORDS.some(kw => haystack.includes(kw))) {
    score += 40;
  }
  if (NEGATIVE_KEYWORDS.some(kw => haystack.includes(kw))) {
    score -= 60;
  }
  if (attr(input, 'inputmode') === 'numeric') {
    score += 20;
  }
  if (type === 'tel' || type === 'number') {
    score += 15;
  }

  const maxLength = input.maxLength;
  if (maxLength >= 4 && maxLength <= 8) {
    score += 25;
  } else if (maxLength === 1) {
    score += 5; // likely a segmented digit box
  }

  return score;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

// Dispatch the events modern frameworks (React/Vue/Angular) listen for.
function dispatchInputEvents(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('keyup', { bubbles: true }));
}

// Detect a segmented one-box-per-digit layout: several single-character
// numeric-ish inputs grouped together. Returns the ordered group if it
// matches the code length, otherwise null.
function findSegmentedGroup(
  candidates: HTMLInputElement[],
  codeLength: number
): HTMLInputElement[] | null {
  const singles = candidates.filter(input => input.maxLength === 1);
  if (singles.length >= codeLength && singles.length <= codeLength + 2) {
    // Order by document position so digits land in the right boxes.
    return singles
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .slice(0, codeLength);
  }
  return null;
}

/**
 * Find the best OTP input on the page and fill it.
 * Returns true if a field was filled, false otherwise.
 */
export function fillOTPCode(otpCode: string, log: Logger = console.log): boolean {
  log(`Attempting to fill OTP (${otpCode.length} digits)`);

  const allInputs = Array.from(
    document.querySelectorAll('input')
  ) as HTMLInputElement[];
  const candidates = allInputs.filter(isFillable);

  if (candidates.length === 0) {
    log('No editable inputs found on page');
    return false;
  }

  // Handle segmented (one-digit-per-box) layouts first.
  const segmented = findSegmentedGroup(candidates, otpCode.length);
  if (segmented) {
    log(`Filling ${segmented.length} segmented input boxes`);
    segmented.forEach((box, i) => {
      box.focus();
      setNativeValue(box, otpCode[i]);
      dispatchInputEvents(box);
    });
    return true;
  }

  // Otherwise score every candidate and pick the most OTP-like one.
  let best: HTMLInputElement | null = null;
  let bestScore = 0; // require a positive score; never fill a penalized field

  for (const input of candidates) {
    const score = scoreInput(input);
    if (score > bestScore) {
      bestScore = score;
      best = input;
    }
  }

  if (!best) {
    log('No suitable OTP input found (no field scored high enough)');
    return false;
  }

  log(`Filling best-match input (score ${bestScore})`);
  best.focus();
  setNativeValue(best, otpCode);
  dispatchInputEvents(best);
  return true;
}

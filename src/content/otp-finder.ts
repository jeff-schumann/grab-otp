// Shared OTP field detection and filling logic used by the Chrome and Firefox
// bridge content scripts.

export type OtpFillStrategy = 'segmented' | 'single' | 'focused' | 'none';

export interface OtpFillResult {
  success: boolean;
  strategy: OtpFillStrategy;
  reason?: string;
  score?: number;
}

type Logger = (message: string) => void;

interface InputCandidate {
  input: HTMLInputElement;
  score: number;
  context: string;
}

const POSITIVE_KEYWORDS = [
  'otp',
  'one-time',
  'onetime',
  'one time',
  'code',
  'verification',
  'verify',
  'authentication',
  'authenticator',
  'security',
  'token',
  'passcode',
  'pin',
  '2fa',
  'mfa',
  'sms',
  'totp'
];

const NEGATIVE_KEYWORDS = [
  'email',
  'e-mail',
  'mail',
  'password',
  'passwd',
  'search',
  'username',
  'user name',
  'firstname',
  'first name',
  'lastname',
  'last-name',
  'last name',
  'phone',
  'mobile',
  'address',
  'zip',
  'postal',
  'coupon',
  'promo',
  'amount',
  'quantity'
];

const EXCLUDED_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'email',
  'file',
  'hidden',
  'image',
  'month',
  'password',
  'radio',
  'range',
  'reset',
  'search',
  'submit',
  'time',
  'url',
  'week'
]);

const SINGLE_INPUT_THRESHOLD = 45;

function attr(input: HTMLInputElement, name: string): string {
  return input.getAttribute(name)?.trim().toLowerCase() ?? '';
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword));
}

function getElementText(element: Element | null): string {
  if (!element) return '';
  return normalizeText(element.textContent ?? '');
}

function getLabelText(input: HTMLInputElement): string {
  const labels = Array.from(input.labels ?? []).map(label => label.textContent ?? '');
  const id = input.id ? cssEscape(input.id) : '';
  if (id) {
    labels.push(
      ...Array.from(document.querySelectorAll(`label[for="${id}"]`)).map(label => label.textContent ?? '')
    );
  }

  return normalizeText(labels.join(' '));
}

function getNearbyText(input: HTMLInputElement): string {
  const parent = input.parentElement;
  const grandparent = parent?.parentElement ?? null;
  const fieldset = input.closest('fieldset');
  const group = input.closest('[role="group"], [aria-label], [aria-labelledby]');

  return normalizeText([
    getLabelText(input),
    getElementText(input.previousElementSibling),
    getElementText(input.nextElementSibling),
    getElementText(parent),
    getElementText(grandparent),
    getElementText(fieldset?.querySelector('legend') ?? null),
    group?.getAttribute('aria-label') ?? '',
    group?.getAttribute('aria-labelledby') ?? ''
  ].join(' '));
}

function getInputContext(input: HTMLInputElement): string {
  return normalizeText([
    attr(input, 'autocomplete'),
    attr(input, 'aria-label'),
    attr(input, 'id'),
    attr(input, 'name'),
    attr(input, 'placeholder'),
    attr(input, 'title'),
    attr(input, 'type'),
    typeof input.className === 'string' ? input.className : '',
    getNearbyText(input)
  ].join(' '));
}

function isElementHiddenByStyle(input: HTMLInputElement): boolean {
  if (input.hidden || input.getAttribute('aria-hidden') === 'true') return true;

  const style = window.getComputedStyle?.(input);
  if (!style) return false;

  return style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    style.pointerEvents === 'none';
}

function isVisible(input: HTMLInputElement): boolean {
  if (isElementHiddenByStyle(input)) return false;

  const rects = input.getClientRects?.();
  if (rects && rects.length > 0) {
    const rectList = Array.from(rects);
    if (rectList.some(rect => rect.width > 0 && rect.height > 0)) return true;
  }

  // Test DOMs and some offscreen-but-usable controls do not calculate useful
  // layout dimensions. Fall back to style/attribute checks instead of treating
  // every zero-sized rect as invisible.
  return true;
}

function isFillable(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase();

  return !input.disabled &&
    !input.readOnly &&
    !EXCLUDED_TYPES.has(type) &&
    isVisible(input);
}

function maxLengthAllows(input: HTMLInputElement, codeLength: number): boolean {
  return input.maxLength < 0 || input.maxLength === 0 || input.maxLength >= codeLength;
}

function isSingleInputCompatible(input: HTMLInputElement, otpCode: string): boolean {
  return isFillable(input) && maxLengthAllows(input, otpCode.length);
}

function scoreInput(input: HTMLInputElement, otpCode: string): InputCandidate {
  const context = getInputContext(input);
  const type = (input.type || 'text').toLowerCase();
  const maxLength = input.maxLength;
  const minLength = input.minLength;
  const autocomplete = attr(input, 'autocomplete');
  const inputMode = attr(input, 'inputmode');
  const pattern = attr(input, 'pattern');
  const currentValue = input.value.trim();
  let score = 0;

  if (autocomplete === 'one-time-code') score += 120;
  if (hasAnyKeyword(context, POSITIVE_KEYWORDS)) score += 45;
  if (hasAnyKeyword(context, NEGATIVE_KEYWORDS)) score -= 70;

  if (inputMode === 'numeric' || inputMode === 'decimal') score += 20;
  if (type === 'tel' || type === 'number') score += 15;
  if (/\\d|\[0-9\]|0-9/.test(pattern)) score += 15;

  if (maxLength === otpCode.length) score += 30;
  else if (maxLength >= 4 && maxLength <= 8) score += 20;
  else if (maxLength > 0 && maxLength < otpCode.length) score -= 80;

  if (minLength === otpCode.length) score += 10;
  if (input.size >= 4 && input.size <= 8) score += 5;

  if (input.matches(':focus')) score += 5;
  if (currentValue) {
    if (/^\d{0,8}$/.test(currentValue)) score -= 10;
    else score -= 45;
  }

  if (!maxLengthAllows(input, otpCode.length)) score -= 80;

  return { input, score, context };
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }
}

function dispatchInputEvents(input: HTMLInputElement): void {
  if (typeof InputEvent === 'function') {
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: input.value
    }));
  } else {
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function documentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function collectInputs(root: Document | ShadowRoot = document): HTMLInputElement[] {
  const inputs = new Set<HTMLInputElement>();
  const visitRoot = (currentRoot: Document | ShadowRoot): void => {
    currentRoot.querySelectorAll('input').forEach(input => inputs.add(input as HTMLInputElement));
    currentRoot.querySelectorAll('*').forEach(element => {
      const shadowRoot = (element as HTMLElement).shadowRoot;
      if (shadowRoot) visitRoot(shadowRoot);
    });
  };

  visitRoot(root);
  return Array.from(inputs).sort(documentOrder);
}

function getSegmentContainer(input: HTMLInputElement): Element | ShadowRoot | Document {
  return input.closest('[role="group"], fieldset, form') ??
    input.parentElement ??
    (input.getRootNode() as Element | ShadowRoot | Document);
}

function isSegmentInput(input: HTMLInputElement): boolean {
  const maxLength = input.maxLength;
  const ariaLabel = attr(input, 'aria-label');
  const name = attr(input, 'name');

  return isFillable(input) &&
    (maxLength === 1 || attr(input, 'maxlength') === '1') &&
    !hasAnyKeyword(`${ariaLabel} ${name}`, ['month', 'day', 'year']);
}

function scoreSegmentedGroup(group: HTMLInputElement[], otpCode: string): number {
  const containerText = normalizeText(group.map(input => getInputContext(input)).join(' '));
  const groupText = normalizeText(group.map(input => getElementText(input.parentElement)).join(' '));
  let score = 20;

  if (group.length === otpCode.length) score += 35;
  if (hasAnyKeyword(`${containerText} ${groupText}`, POSITIVE_KEYWORDS)) score += 45;
  if (hasAnyKeyword(`${containerText} ${groupText}`, NEGATIVE_KEYWORDS)) score -= 90;
  if (group.every(input => ['numeric', 'decimal'].includes(attr(input, 'inputmode')))) score += 20;
  if (group.every(input => !input.value || /^\d$/.test(input.value))) score += 10;

  return score;
}

function findSegmentedGroup(candidates: HTMLInputElement[], otpCode: string): { inputs: HTMLInputElement[]; score: number } | null {
  const singles = candidates.filter(isSegmentInput).sort(documentOrder);
  if (singles.length < otpCode.length) return null;

  const candidateGroups: HTMLInputElement[][] = [];
  const byContainer = new Map<Element | ShadowRoot | Document, HTMLInputElement[]>();

  for (const single of singles) {
    const container = getSegmentContainer(single);
    byContainer.set(container, [...(byContainer.get(container) ?? []), single]);
  }

  byContainer.forEach(group => {
    const ordered = group.sort(documentOrder);
    if (ordered.length >= otpCode.length && ordered.length <= otpCode.length + 2) {
      candidateGroups.push(ordered.slice(0, otpCode.length));
    }
  });

  if (candidateGroups.length === 0 && singles.length <= otpCode.length + 2) {
    candidateGroups.push(singles.slice(0, otpCode.length));
  }

  let best: { inputs: HTMLInputElement[]; score: number } | null = null;
  for (const group of candidateGroups) {
    const score = scoreSegmentedGroup(group, otpCode);
    if (!best || score > best.score) {
      best = { inputs: group, score };
    }
  }

  return best && best.score >= SINGLE_INPUT_THRESHOLD ? best : null;
}

function getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
  const active = root.activeElement;
  const shadowRoot = active && (active as HTMLElement).shadowRoot;
  if (shadowRoot?.activeElement) {
    return getDeepActiveElement(shadowRoot);
  }

  return active;
}

function fillSingleInput(input: HTMLInputElement, otpCode: string): void {
  input.focus();
  input.select?.();
  setNativeValue(input, otpCode);
  dispatchInputEvents(input);
}

function fillSegmentedInputs(inputs: HTMLInputElement[], otpCode: string): void {
  inputs.forEach((input, index) => {
    input.focus();
    setNativeValue(input, otpCode[index] ?? '');
    dispatchInputEvents(input);
  });
}

export function findOTPFillTarget(otpCode: string): OtpFillResult & { input?: HTMLInputElement; inputs?: HTMLInputElement[] } {
  const candidates = collectInputs().filter(isFillable);
  if (candidates.length === 0) {
    return { success: false, strategy: 'none', reason: 'no-inputs' };
  }

  const segmented = findSegmentedGroup(candidates, otpCode);
  if (segmented) {
    return { success: true, strategy: 'segmented', inputs: segmented.inputs, score: segmented.score };
  }

  const scored = candidates
    .filter(input => isSingleInputCompatible(input, otpCode))
    .map(input => scoreInput(input, otpCode))
    .sort((a, b) => b.score - a.score || documentOrder(a.input, b.input));

  const best = scored[0];
  if (best && best.score >= SINGLE_INPUT_THRESHOLD) {
    return { success: true, strategy: 'single', input: best.input, score: best.score };
  }

  const focused = getDeepActiveElement();
  if (focused instanceof HTMLInputElement && isSingleInputCompatible(focused, otpCode)) {
    return { success: true, strategy: 'focused', input: focused, score: best?.score };
  }

  return {
    success: false,
    strategy: 'none',
    reason: best ? 'low-confidence' : 'no-compatible-input',
    score: best?.score
  };
}

export function fillOTPCode(otpCode: string, log: Logger = () => undefined): OtpFillResult {
  log(`Attempting OTP auto-fill for ${otpCode.length} digit code`);

  if (!/^\d{4,8}$/.test(otpCode)) {
    log('OTP auto-fill skipped: unsupported code format');
    return { success: false, strategy: 'none', reason: 'invalid-code' };
  }

  const target = findOTPFillTarget(otpCode);
  if (!target.success) {
    log(`OTP auto-fill skipped: ${target.reason ?? 'no-target'}`);
    return target;
  }

  if (target.strategy === 'segmented' && target.inputs) {
    log(`Filling ${target.inputs.length} segmented inputs (score ${target.score})`);
    fillSegmentedInputs(target.inputs, otpCode);
    return { success: true, strategy: 'segmented', score: target.score };
  }

  if (target.input) {
    log(`Filling ${target.strategy} input (score ${target.score ?? 0})`);
    fillSingleInput(target.input, otpCode);
    return { success: true, strategy: target.strategy, score: target.score };
  }

  return { success: false, strategy: 'none', reason: 'no-target' };
}

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillOTPCode } from './otp-finder';

const noop = vi.fn();

describe('fillOTPCode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    noop.mockClear();
  });

  it('fills a labeled single OTP input', () => {
    document.body.innerHTML = `
      <label for="otp">Verification code</label>
      <input id="otp" inputmode="numeric" maxlength="6">
    `;
    const input = document.getElementById('otp') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const result = fillOTPCode('123456', noop);

    expect(result).toMatchObject({ success: true, strategy: 'single' });
    expect(input.value).toBe('123456');
    expect(events).toEqual(['input', 'change']);
  });

  it('prefers autocomplete one-time-code over other numeric fields', () => {
    document.body.innerHTML = `
      <input id="phone" name="phone" type="tel" maxlength="10" placeholder="Phone">
      <input id="code" autocomplete="one-time-code" maxlength="6">
    `;

    const result = fillOTPCode('654321', noop);

    expect(result).toMatchObject({ success: true, strategy: 'single' });
    expect((document.getElementById('phone') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('code') as HTMLInputElement).value).toBe('654321');
  });

  it('fills segmented digit inputs in document order', () => {
    document.body.innerHTML = `
      <div role="group" aria-label="Verification code">
        <input maxlength="1" inputmode="numeric">
        <input maxlength="1" inputmode="numeric">
        <input maxlength="1" inputmode="numeric">
        <input maxlength="1" inputmode="numeric">
        <input maxlength="1" inputmode="numeric">
        <input maxlength="1" inputmode="numeric">
      </div>
    `;

    const result = fillOTPCode('112233', noop);
    const values = Array.from(document.querySelectorAll('input')).map(input => input.value);

    expect(result).toMatchObject({ success: true, strategy: 'segmented' });
    expect(values).toEqual(['1', '1', '2', '2', '3', '3']);
  });

  it('penalizes negative fields and fills the OTP candidate instead', () => {
    document.body.innerHTML = `
      <input id="phone" name="phone" type="tel" maxlength="6" placeholder="Phone">
      <label for="otp">Security code</label>
      <input id="otp" maxlength="6">
    `;

    const result = fillOTPCode('222333', noop);

    expect(result).toMatchObject({ success: true, strategy: 'single' });
    expect((document.getElementById('phone') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('otp') as HTMLInputElement).value).toBe('222333');
  });

  it('uses the focused compatible input as a fallback when confidence is low', () => {
    document.body.innerHTML = '<input id="plain" maxlength="6">';
    const input = document.getElementById('plain') as HTMLInputElement;
    input.focus();

    const result = fillOTPCode('987654', noop);

    expect(result).toMatchObject({ success: true, strategy: 'focused' });
    expect(input.value).toBe('987654');
  });

  it('does not overwrite an existing non-focused unrelated code field', () => {
    document.body.innerHTML = `
      <input id="promo" placeholder="Promo code" maxlength="6" value="SAVE10">
      <label for="otp">Verification code</label>
      <input id="otp" maxlength="6">
    `;

    const result = fillOTPCode('101010', noop);

    expect(result).toMatchObject({ success: true, strategy: 'single' });
    expect((document.getElementById('promo') as HTMLInputElement).value).toBe('SAVE10');
    expect((document.getElementById('otp') as HTMLInputElement).value).toBe('101010');
  });

  it('finds OTP inputs inside open shadow roots', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <label>
        One-time code
        <input id="shadow-code" maxlength="6" inputmode="numeric">
      </label>
    `;
    document.body.appendChild(host);

    const result = fillOTPCode('333444', noop);
    const input = shadow.getElementById('shadow-code') as HTMLInputElement;

    expect(result).toMatchObject({ success: true, strategy: 'single' });
    expect(input.value).toBe('333444');
  });

  it('returns a no-match result when no compatible field exists', () => {
    document.body.innerHTML = '<input id="short" maxlength="3">';

    const result = fillOTPCode('123456', noop);

    expect(result.success).toBe(false);
    expect(result.strategy).toBe('none');
    expect((document.getElementById('short') as HTMLInputElement).value).toBe('');
  });
});

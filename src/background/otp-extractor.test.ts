import { describe, expect, it } from 'vitest';
import { extractOtpFromText } from './otp-extractor';

describe('extractOtpFromText', () => {
  it('prefers the labeled code over an order number that appears first', () => {
    const text = 'Order #482910 confirmed. Your verification code is 738261.';
    expect(extractOtpFromText(text)).toBe('738261');
  });

  it('matches a labeled code even when filler words sit between label and digits', () => {
    expect(extractOtpFromText('Your verification code is 123456')).toBe('123456');
    expect(extractOtpFromText('Enter this code to verify: 654321')).toBe('654321');
  });

  it('handles "123456 is your verification code" (code before label)', () => {
    expect(extractOtpFromText('918273 is your verification code.')).toBe('918273');
  });

  it('reads a code split into 3-3 groups', () => {
    expect(extractOtpFromText('Your code: 123 456')).toBe('123456');
    expect(extractOtpFromText('Use 246-802 to sign in')).toBe('246802');
  });

  it('extracts the digits from Google-style G-123456', () => {
    expect(extractOtpFromText('G-557914 is your Google verification code')).toBe('557914');
  });

  it('prefers a 6-digit code over an unrelated 4-digit number with no label', () => {
    expect(extractOtpFromText('We charged 1299 to your card. Code 445566 follows.')).toBe('445566');
  });

  it('does not return a bare year as a code', () => {
    expect(extractOtpFromText('Copyright 2026 Acme Inc. All rights reserved.')).toBeNull();
  });

  it('ignores numbers preceded by negative markers like $ and order', () => {
    expect(extractOtpFromText('Amount $4500 for order 778899 — your OTP is 314159'))
      .toBe('314159');
  });

  it('does not match an embedded 10-digit phone number', () => {
    expect(extractOtpFromText('Call us at 8005551234 for help')).toBeNull();
  });

  it('returns null when there is no plausible candidate', () => {
    expect(extractOtpFromText('Thanks for signing up! Welcome aboard.')).toBeNull();
    expect(extractOtpFromText('')).toBeNull();
  });

  it('supports 8-digit and 4-digit codes', () => {
    expect(extractOtpFromText('Your security code is 12345678')).toBe('12345678');
    expect(extractOtpFromText('Your PIN is 4821')).toBe('4821');
  });
});

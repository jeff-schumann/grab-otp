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

  describe('letter-bearing codes', () => {
    it('reads an all-letter code isolated on its own line', () => {
      const text = 'Your 2FA code is:\n\nATVAOGXLPR\n\nThanks for being a customer!';
      expect(extractOtpFromText(text)).toBe('ATVAOGXLPR');
    });

    it('reads an all-letter code that follows a label colon inline', () => {
      expect(extractOtpFromText('Your verification code is: QRMZPLKD')).toBe('QRMZPLKD');
    });

    it('reads a mixed letter-and-digit code without needing isolation', () => {
      expect(extractOtpFromText('Your one-time code is X7K2P9 — expires in 10 minutes.'))
        .toBe('X7K2P9');
    });

    it('does not treat capitalized prose as a code', () => {
      const text = 'YOUR VERIFICATION CODE IS BELOW\nPlease do not share it with anyone.';
      expect(extractOtpFromText(text)).toBeNull();
    });

    it('does not return the label word itself as the code', () => {
      expect(extractOtpFromText('Your verification code:\n\nCODE')).toBeNull();
      expect(extractOtpFromText('Enter the code to verify:\n\nVERIFY')).toBeNull();
    });

    it('ignores an isolated all-letter run with no code label nearby', () => {
      const text = 'Welcome aboard!\n\nPORKBUN\n\nWe are glad you are here.';
      expect(extractOtpFromText(text)).toBeNull();
    });
  });

  describe('requires a code label', () => {
    it('returns null for the Porkbun footer address rather than guessing', () => {
      // The real code is alphabetic, so before letter support this email yielded
      // "11575" — the street number from the mailing address in the footer.
      const text = [
        'Porkbun account notice',
        'Some unrelated message body with no code in it at all.',
        'Thanks for being a Porkbun customer!',
        'Porkbun LLC, 11575 SW Pacific Hwy, Tigard, OR 97223',
        'Unsubscribe | Privacy Policy'
      ].join('\n');
      expect(extractOtpFromText(text)).toBeNull();
    });

    it('rejects an unlabeled number in a long email', () => {
      const text = 'Your order has shipped and should arrive soon. '
        + 'Tracking is handled by our carrier partner and updates every few hours. '
        + 'Reference 582910 appears on the packing slip inside the box. '
        + 'Reply to this email if anything looks wrong with the delivery.';
      expect(extractOtpFromText(text)).toBeNull();
    });

    it('penalizes a number that sits in the unsubscribe footer', () => {
      const text = 'Your verification code is 445566.\n'
        + 'Unsubscribe | Acme Inc, 998877 Market St, Portland, OR 97204';
      expect(extractOtpFromText(text)).toBe('445566');
    });
  });

  describe('short-email valve', () => {
    it('accepts a lone unlabeled number in a very short email', () => {
      expect(extractOtpFromText('483920')).toBe('483920');
      expect(extractOtpFromText('Hi there\n\n729104\n\nThanks')).toBe('729104');
    });

    it('does not accept a lone year in a short email', () => {
      expect(extractOtpFromText('Acme Inc 2026')).toBeNull();
    });

    it('does not accept a lone unlabeled number once the email is long', () => {
      const filler = 'This message contains general account information for your records. ';
      expect(extractOtpFromText(`${filler}${filler}${filler}483920`)).toBeNull();
    });

    it('does not apply when more than one candidate is present', () => {
      expect(extractOtpFromText('Ref 1234 and 5678')).toBeNull();
    });

    it('does not apply to letter-bearing candidates', () => {
      expect(extractOtpFromText('ATVAOGXLPR')).toBeNull();
    });
  });

  describe('address and boilerplate suppression', () => {
    it('does not pick a street number sitting next to a code label', () => {
      const text = 'Your code is on the way.\nAcme Inc, 11575 SW Pacific Hwy, Tigard, OR 97223';
      expect(extractOtpFromText(text)).toBeNull();
    });

    it('still finds the code when an address appears alongside it', () => {
      const text = 'Your verification code is 604811.\n'
        + 'Acme Inc, 11575 SW Pacific Hwy, Tigard, OR 97223';
      expect(extractOtpFromText(text)).toBe('604811');
    });
  });
});

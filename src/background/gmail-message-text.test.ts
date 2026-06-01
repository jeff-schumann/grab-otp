import { describe, expect, it } from 'vitest';
import { getGmailMessageTextContent } from './gmail-message-text';

function gmailBase64Url(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('getGmailMessageTextContent', () => {
  it('includes rendered text from HTML-only message parts', () => {
    const text = getGmailMessageTextContent({
      payload: {
        parts: [
          {
            mimeType: 'text/html',
            body: {
              data: gmailBase64Url('<html><body><p>Your verification code:</p><strong>123456</strong></body></html>')
            }
          }
        ]
      }
    });

    expect(text).toContain('Your verification code: 123456');
  });
});

import { describe, expect, it } from 'vitest';
import { getGmailMessageSubject, getGmailMessageTextContent, htmlToText } from './gmail-message-text';

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

    expect(text).toContain('Your verification code:');
    expect(text).toContain('123456');
  });
});

describe('htmlToText', () => {
  it('turns block-level tags into line breaks', () => {
    // The extractor treats a run of letters alone on a line as a code, so block
    // boundaries have to survive rather than collapsing into spaces.
    expect(htmlToText('<p>Your 2FA code is:</p><p>ATVAOGXLPR</p>'))
      .toBe('Your 2FA code is:\nATVAOGXLPR');
    expect(htmlToText('Line one<br>Line two')).toBe('Line one\nLine two');
  });

  it('collapses runs of spaces and blank lines without losing breaks', () => {
    expect(htmlToText('<div>  a  </div>\n\n\n<div>  b  </div>')).toBe('a\nb');
  });

  it('keeps inline markup from breaking a line apart', () => {
    expect(htmlToText('<p>Code <strong>445566</strong> expires soon</p>'))
      .toBe('Code 445566 expires soon');
  });

  it('drops script and style content', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Hi</p><script>var x=1</script>'))
      .toBe('Hi');
  });
});

describe('getGmailMessageSubject', () => {
  it('reads the Subject header regardless of casing', () => {
    expect(getGmailMessageSubject({
      payload: { headers: [{ name: 'subject', value: 'Your verification code' }] }
    })).toBe('Your verification code');
  });

  it('returns an empty string when there is no subject', () => {
    expect(getGmailMessageSubject({ payload: {} })).toBe('');
  });
});

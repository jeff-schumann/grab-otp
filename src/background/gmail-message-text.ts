export interface GmailMessagePart {
  body: { data?: string };
  mimeType: string;
  parts?: GmailMessagePart[];
}

export interface GmailMessageWithPayload {
  payload: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailMessagePart[];
    body?: { data?: string };
  };
}

/**
 * The message's Subject header, or ''. Subjects carry the OTP label far more
 * often than the body does ("Your Porkbun verification code"), and the
 * extractor needs that label to accept a code at all.
 */
export function getGmailMessageSubject(message: GmailMessageWithPayload): string {
  const header = message.payload.headers?.find(h => h.name.toLowerCase() === 'subject');
  return header?.value ?? '';
}

export function getGmailMessageTextContent(message: GmailMessageWithPayload): string {
  const textParts: string[] = [];

  const collectText = (part: GmailMessagePart): void => {
    if (part.body.data) {
      const decoded = decodeGmailBase64(part.body.data);
      if (part.mimeType === 'text/plain') {
        textParts.push(decoded);
      } else if (part.mimeType === 'text/html') {
        textParts.push(htmlToText(decoded));
      }
    }

    part.parts?.forEach(collectText);
  };

  message.payload.parts?.forEach(collectText);

  if (message.payload.body?.data) {
    textParts.push(decodeGmailBase64(message.payload.body.data));
  }

  return textParts.join('\n');
}

// Tags that end a visual line. Collapsing these to spaces used to run the code
// into the surrounding copy, which hid the single strongest signal that a run
// of letters is a code rather than prose: standing alone on its own line.
const BLOCK_TAGS =
  /<\s*\/?\s*(?:br|p|div|tr|td|th|li|ul|ol|h[1-6]|table|tbody|thead|section|article|header|footer|blockquote|pre|hr|center)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_match, codePoint: string) => String.fromCharCode(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) => String.fromCharCode(parseInt(codePoint, 16)))
    // Collapse runs of spaces/tabs, then runs of blank lines, keeping breaks.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

function decodeGmailBase64(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(escape(atob(base64)));
  } catch (error) {
    console.error('Error decoding Gmail base64:', error);
    return '';
  }
}

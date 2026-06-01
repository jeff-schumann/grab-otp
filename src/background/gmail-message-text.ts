export interface GmailMessagePart {
  body: { data?: string };
  mimeType: string;
  parts?: GmailMessagePart[];
}

export interface GmailMessageWithPayload {
  payload: {
    parts?: GmailMessagePart[];
    body?: { data?: string };
  };
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

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_match, codePoint: string) => String.fromCharCode(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) => String.fromCharCode(parseInt(codePoint, 16)))
    .replace(/\s+/g, ' ')
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

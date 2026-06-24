// Shared forwarded-SMS OTP fetch.
//
// All three background variants (Chrome/Firefox/Safari) call this so the
// query, freshness window, and extraction live in one place. The Gmail REST
// calls use the global `fetch` + a Bearer token, which is identical across
// browsers — only token acquisition differs, so each caller passes the token
// it already holds.

import { getGmailMessageTextContent, type GmailMessageWithPayload } from './gmail-message-text';
import { extractOtpFromText } from './otp-extractor';
import { buildSmsQuery, SMS_MAX_AGE_MS } from './gmail-query';

interface SmsOtpResponse {
  success: boolean;
  otp?: string;
  error?: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string }>;
}

// Full-format message includes the snippet and internalDate (epoch ms string).
type GmailFullMessage = GmailMessageWithPayload & {
  snippet?: string;
  internalDate?: string;
};

async function gmailGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('401 Unauthorized - token expired');
    throw new Error(`Gmail API error: ${response.status}`);
  }

  return await response.json() as T;
}

/**
 * Find the newest forwarded-SMS email within the freshness window and extract
 * its code. Domain-agnostic: it matches purely on the relay's subject tag.
 */
export async function fetchSmsOtpWithToken(
  token: string,
  userEmail: string,
  now: number = Date.now()
): Promise<SmsOtpResponse> {
  const base = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages`;
  const listUrl = `${base}?q=${encodeURIComponent(buildSmsQuery())}&maxResults=10`;

  const list = await gmailGet<GmailListResponse>(listUrl, token);
  const messages = list.messages || [];
  if (messages.length === 0) {
    return { success: false, error: 'No forwarded SMS code found. Check that the text reached Gmail.' };
  }

  // Gmail returns newest first. Walk forward until a message is too old (every
  // later one is older still, so we can stop) or we find a code.
  let sawStale = false;
  for (const message of messages.slice(0, 5)) {
    const detail = await gmailGet<GmailFullMessage>(`${base}/${message.id}`, token);

    const internalDate = Number(detail.internalDate);
    if (Number.isFinite(internalDate) && now - internalDate > SMS_MAX_AGE_MS) {
      sawStale = true;
      break;
    }

    const text = `${detail.snippet || ''}\n${getGmailMessageTextContent(detail)}`;
    const otp = extractOtpFromText(text);
    if (otp) return { success: true, otp };
  }

  return {
    success: false,
    error: sawStale
      ? 'The latest forwarded SMS code is too old. Request a new code and try again.'
      : 'No code found in the latest forwarded SMS.'
  };
}

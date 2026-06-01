// Firefox OTP bridge content script.

import { fillOTPCode, type OtpFillResult } from './otp-finder';

declare const browser: typeof chrome;

interface FillOtpMessage {
  action: 'fillOTP';
  otp?: string;
}

type FillOtpResponse = OtpFillResult;

const log = (message: string) => console.log('[Firefox OTP Bridge]', message);

log(`Ready on ${window.location.href}`);

browser.runtime.onMessage.addListener((
  message: FillOtpMessage,
  _sender: unknown,
  sendResponse: (response?: FillOtpResponse) => void
) => {
  if (message.action === 'fillOTP' && message.otp) {
    sendResponse(fillOTPCode(message.otp, log));
    return true;
  }

  return false;
});

// Minimal bridge content script for OTP auto-fill.
// Injected immediately on user click to maintain activeTab permission.

import { fillOTPCode, type OtpFillResult } from './otp-finder';

type ExtensionApi = typeof chrome;

interface FillOtpMessage {
  action: 'fillOTP';
  otp?: string;
}

type FillOtpResponse = OtpFillResult;

const extensionGlobal = globalThis as typeof globalThis & {
  chrome?: ExtensionApi;
  browser?: ExtensionApi;
};

const extensionApi = (extensionGlobal.chrome ?? extensionGlobal.browser) as ExtensionApi;
const log = (message: string) => console.log('[OTP Bridge]', message);

log(`Ready on ${window.location.href}`);

extensionApi.runtime.onMessage.addListener((
  message: FillOtpMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: FillOtpResponse) => void
) => {
  if (message.action === 'fillOTP' && message.otp) {
    sendResponse(fillOTPCode(message.otp, log));
    return true;
  }

  return false;
});

export {};

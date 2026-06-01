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
  __grabOtpBridgeReady?: boolean;
};

const extensionApi = (extensionGlobal.chrome ?? extensionGlobal.browser) as ExtensionApi;
const log = (message: string) => console.log('[OTP Bridge]', message);

// executeScript re-runs this file on every grab. The isolated-world globals
// persist across injections, so guard the listener to avoid stacking duplicates
// that would race sendResponse on later clicks.
if (extensionGlobal.__grabOtpBridgeReady) {
  log('Bridge already active; skipping re-init');
} else {
  extensionGlobal.__grabOtpBridgeReady = true;
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
}

export {};

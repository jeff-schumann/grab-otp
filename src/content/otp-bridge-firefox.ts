// Firefox OTP bridge content script.

import { fillOTPCode, type OtpFillResult } from './otp-finder';

declare const browser: typeof chrome;

interface FillOtpMessage {
  action: 'fillOTP';
  otp?: string;
}

type FillOtpResponse = OtpFillResult;

const bridgeGlobal = globalThis as typeof globalThis & { __grabOtpBridgeReady?: boolean };
const log = (message: string) => console.log('[Firefox OTP Bridge]', message);

// Guard against duplicate listeners if the bridge is injected more than once;
// stacked listeners would race sendResponse on later grabs.
if (bridgeGlobal.__grabOtpBridgeReady) {
  log('Bridge already active; skipping re-init');
} else {
  bridgeGlobal.__grabOtpBridgeReady = true;
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
}

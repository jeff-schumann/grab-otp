// Minimal bridge content script for OTP auto-fill
// Injected immediately on user click to maintain activeTab permission
// Receives OTP data via direct message from popup

import { fillOTPCode } from './otp-finder';

type ExtensionApi = typeof chrome;

const extensionGlobal = globalThis as typeof globalThis & {
  chrome?: ExtensionApi;
  browser?: ExtensionApi;
};
const extensionApi = (extensionGlobal.chrome ?? extensionGlobal.browser) as ExtensionApi;

const log = (message: string) => console.log('[OTP Bridge]', message);

log('Content script loaded on: ' + window.location.href);

// Listen for direct messages from popup (more reliable than ports)
extensionApi.runtime.onMessage.addListener((
  message: { action: string; otp?: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: { success: boolean }) => void
) => {
  log('Received message: ' + message.action);

  if (message.action === 'fillOTP' && message.otp) {
    const filled = fillOTPCode(message.otp, log);
    sendResponse({ success: filled });
  }
  return true;
});

log('Ready for OTP data');

export {};

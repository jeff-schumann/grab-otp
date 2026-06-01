// Firefox OTP Bridge Content Script
// Enhanced bridge for Firefox with proper browser API usage and React/Vue compatibility
import { fillOTPCode } from './otp-finder';

const log = (message: string) => console.log('[Firefox OTP Bridge]', message);

log('Loading on: ' + window.location.href);

// Listen for direct messages from popup (more reliable than ports)
browser.runtime.onMessage.addListener((
  message: { action: string; otp?: string },
  _sender: unknown,
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

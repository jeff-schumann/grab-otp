// Firefox background script - uses global browser from polyfill
import { checkForUpdates } from '../shared/version-check';
import { AccountManager, TOKEN_REFRESH_ALARM } from '../shared/account-manager';
import { type OtpFillResult } from '../content/otp-finder';
import { getGmailMessageTextContent } from './gmail-message-text';
import { extractOtpFromText } from './otp-extractor';
import { buildSenderQuery } from './gmail-query';

declare const browser: any;
declare const __FIREFOX_CLIENT_ID__: string;
declare const __FIREFOX_CLIENT_SECRET__: string;

interface OTPResponse {
  success: boolean;
  otp?: string;
  error?: string;
}

interface GmailMessage {
  id: string;
  snippet: string;
}

interface GmailSearchResponse {
  messages?: GmailMessage[];
}

interface GmailMessageResponse {
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{
      body: { data: string };
      mimeType: string;
    }>;
    body?: { data: string };
  };
  snippet: string;
}

// Initialize AccountManager
const accountManager = new AccountManager(
  browser.storage,
  browser.identity,
  __FIREFOX_CLIENT_ID__,
  __FIREFOX_CLIENT_SECRET__
);

class FirefoxGmailOTPFetcher {
  // Fire-and-forget OTP fetch with full background processing
  async processOTPRequest(domain: string, requestTimestamp: number, autoFill: boolean = false, tabId?: number): Promise<void> {
    console.log(`Starting OTP fetch for domain: ${domain}, autoFill: ${autoFill}`);

    try {
      const result = await this.fetchOTPForDomain(domain);

      if (result.success && result.otp) {
        if (autoFill && tabId) {
          // Capture the bridge's fill result so the popup can decide whether to
          // close. Mirrors Chrome's sendOtpToBridge: never throws — a missing
          // bridge or a failed fill resolves to success:false instead.
          let autoFillResult: OtpFillResult | undefined;
          try {
            console.log('[Firefox Background] Sending OTP to bridge for auto-fill');
            autoFillResult = await browser.tabs.sendMessage(
              tabId,
              { action: 'fillOTP', otp: result.otp }
            ) as OtpFillResult | undefined;
          } catch (error) {
            console.log('[Firefox Background] Bridge not available, falling back to clipboard:', error);
            autoFillResult = { success: false, strategy: 'none', reason: (error as Error).message };
          }

          // Always copy to clipboard as backup
          await this.copyToClipboard(result.otp);

          const message = autoFillResult?.success
            ? `OTP: ${result.otp} (auto-filled & copied)`
            : `OTP: ${result.otp} (copied to clipboard)`;

          await this.showPopupWithResult({
            success: true,
            otp: result.otp,
            domain: domain,
            message,
            tabId,
            autoFillResult
          });
        } else {
          // Copy to clipboard (original behavior)
          await this.copyToClipboard(result.otp);
          await this.showPopupWithResult({
            success: true,
            otp: result.otp,
            domain: domain,
            message: `OTP: ${result.otp} (copied to clipboard)`
          });
        }


        console.log('OTP found and copied successfully');
      } else {
        // Show popup with error result
        await this.showPopupWithResult({
          success: false,
          domain: domain,
          message: result.error || `No OTP found in recent emails for ${domain}`
        });


        console.log(`No OTP found: ${result.error}`);
      }
    } catch (error) {
      console.error('Error in OTP processing:', error);
      const errorMessage = (error as Error).message;

      // Show popup with error result
      await this.showPopupWithResult({
        success: false,
        domain: domain,
        message: `Error: ${errorMessage}`
      });

    }
  }


  private async fetchOTPForDomain(domain: string): Promise<OTPResponse> {
    try {
      // Get token from active account
      console.log('Getting access token from AccountManager...');
      const tokenInfo = await accountManager.getActiveAccountToken();

      if (!tokenInfo) {
        // Check if we have any accounts
        const hasAccounts = await accountManager.hasAccounts();
        if (!hasAccounts) {
          return { success: false, error: 'No Gmail account configured. Click extension icon to add an account.' };
        }
        return { success: false, error: 'Gmail authentication expired. Please re-authenticate.' };
      }

      const { token, email } = tokenInfo;
      console.log('Using account:', email);

      const messages = await this.searchGmailMessages(token, email, domain);
      if (!messages || messages.length === 0) {
        return { success: false, error: `No recent emails found for ${domain}` };
      }

      for (const message of messages.slice(0, 5)) {
        const messageDetail = await this.getMessageDetail(token, email, message.id);
        const otp = this.extractOTP(messageDetail);

        if (otp) {
          return { success: true, otp };
        }
      }

      return { success: false, error: 'No OTP found in recent emails' };
    } catch (error) {
      console.error('Error fetching OTP:', error);

      // If it's an auth error, suggest re-authentication
      if (error instanceof Error && error.message.includes('401')) {
        console.log('Authentication expired');
        return { success: false, error: 'Authentication expired - please try again' };
      }

      return { success: false, error: (error as Error).message };
    }
  }

  private async copyToClipboard(text: string): Promise<void> {
    try {
      // Firefox clipboard via programmatic injection (activeTab permission)
      const results = await browser.tabs.query({active: true, currentWindow: true});
      if (results.length > 0 && results[0].id) {
        try {
          // Programmatic injection of clipboard helper
          const clipboardResult = await browser.tabs.executeScript(results[0].id, {
            code: `
              (function() {
                const text = '${text.replace(/[\\'"`]/g, '')}'; // Sanitize

                // Validate OTP format
                if (!/^\\d{4,8}$/.test(text)) {
                  return 'invalid_format';
                }

                // Try modern clipboard API first
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(() => {
                    console.log('Clipboard copy successful (modern API)');
                  }).catch(err => {
                    console.log('Modern clipboard API failed:', err);
                  });
                  return 'modern_api_attempted';
                }

                // Fallback to execCommand
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);

                return success ? 'execCommand_success' : 'execCommand_failed';
              })();
            `
          });

          console.log('Programmatic clipboard injection result:', clipboardResult);
          return;
        } catch (error) {
          console.log('Programmatic injection failed:', error);
          // If we can't inject, we'll just proceed without clipboard copy
        }
      }

      console.warn('No active tab found for clipboard operations');

    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Don't throw - we still want to show the notification
    }
  }

  private async showPopupWithResult(result: {
    success: boolean;
    otp?: string;
    domain: string;
    message: string;
    tabId?: number;
    autoFillResult?: OtpFillResult;
  }): Promise<void> {
    try {
      console.log('Storing result and updating badge');

      // Get active account email to include in result
      const activeEmail = await accountManager.getActiveAccountEmail();

      // Store the result for the popup to display
      await browser.storage.local.set({
        'latest_otp_result': {
          ...result,
          accountEmail: activeEmail,
          timestamp: Date.now()
        }
      });

      console.log('Result stored for popup polling');
    } catch (error) {
      console.error('Failed to store result:', error);

      // Fallback: try to store without badge updates
      try {
        await browser.storage.local.set({
          'latest_otp_result': {
            ...result,
            timestamp: Date.now()
          }
        });
        console.log('Result stored via fallback');
      } catch (storageError) {
        console.error('Complete storage failure:', storageError);
      }
    }
  }

  private async searchGmailMessages(token: string, userEmail: string, domain: string): Promise<GmailMessage[]> {
    const query = `${buildSenderQuery(domain)} newer_than:30m`;
    // Use specific user email instead of 'me' for multi-account support
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages?q=${encodeURIComponent(query)}&maxResults=10`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('401 Unauthorized - token expired');
      }
      throw new Error(`Gmail API error: ${response.status}`);
    }

    const data: GmailSearchResponse = await response.json();
    return data.messages || [];
  }

  private async getMessageDetail(token: string, userEmail: string, messageId: string): Promise<GmailMessageResponse> {
    // Use specific user email instead of 'me' for multi-account support
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${messageId}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('401 Unauthorized - token expired');
      }
      throw new Error(`Gmail API error: ${response.status}`);
    }

    return await response.json();
  }

  private extractOTP(message: GmailMessageResponse): string | null {
    const content = getGmailMessageTextContent(message);
    const searchText = `${message.snippet || ''}\n${content}`;
    return extractOtpFromText(searchText);
  }

}

const firefoxOtpFetcher = new FirefoxGmailOTPFetcher();

// Enhanced message handler
browser.runtime.onMessage.addListener(async (message: any, _sender: any, _sendResponse: any) => {
  // Account management messages
  if (message.action === 'getAccounts') {
    const accounts = await accountManager.getAllAccounts();
    const activeEmail = await accountManager.getActiveAccountEmail();
    return { accounts, activeEmail };
  }

  if (message.action === 'addAccount') {
    const email = await accountManager.addAccount();
    if (email) await scheduleTokenRefresh();
    return { success: !!email, email };
  }

  if (message.action === 'removeAccount') {
    await accountManager.removeAccount(message.email);
    return { success: true };
  }

  if (message.action === 'setActiveAccount') {
    await accountManager.setActiveAccount(message.email);
    return { success: true };
  }

  if (message.action === 'injectBridge') {
    // Immediately inject bridge on user interaction
    try {
      console.log('[Firefox Background] Injecting bridge for tab:', message.tabId);
      await injectBridgeScript(message.tabId);
      return { success: true };
    } catch (error) {
      console.error('[Firefox Background] Bridge injection failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  if (message.action === 'fetchOTP') {
    // Process in background without blocking the message response
    firefoxOtpFetcher.processOTPRequest(message.domain, message.timestamp, message.autoFill || false, message.tabId);
    // Return immediately (no response needed)
    return;
  }

  if (message.action === 'sendOTPToBridge') {
    // Forward OTP to bridge via direct message
    try {
      console.log('[Firefox Background] Forwarding OTP to bridge');
      await browser.tabs.sendMessage(message.tabId, { action: 'fillOTP', otp: message.otp });
    } catch (error) {
      console.log('[Firefox Background] Could not send to bridge:', error);
    }
    return;
  }
});

// Feature detection for injection API with separate bridge file
async function injectBridgeScript(tabId: number): Promise<void> {
  // Validate tab permissions before injection
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://')) {
      throw new Error('Cannot inject into system pages');
    }
  } catch {
    throw new Error('Invalid tab or insufficient permissions');
  }

  // Feature detection: prefer scripting API, fallback to tabs
  if (browser.scripting && browser.scripting.executeScript) {
    console.log('[Firefox Background] Using modern scripting API');
    await browser.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['otp-bridge-firefox.js']
    });
  } else if (browser.tabs && browser.tabs.executeScript) {
    console.log('[Firefox Background] Using legacy tabs API');
    await browser.tabs.executeScript(tabId, {
      file: 'otp-bridge-firefox.js',
      allFrames: true
    });
  } else {
    throw new Error('No script injection API available');
  }
}

// Schedule proactive token refresh alarm
async function scheduleTokenRefresh() {
  const delayMinutes = await accountManager.getNextRefreshDelay();
  if (delayMinutes > 0) {
    browser.alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: delayMinutes });
    console.log(`[Firefox Background] Token refresh alarm scheduled in ${delayMinutes} minutes`);
  }
}

// Handle alarm events
browser.alarms.onAlarm.addListener(async (alarm: any) => {
  if (alarm.name === TOKEN_REFRESH_ALARM) {
    console.log('[Firefox Background] Token refresh alarm fired');
    const nextDelay = await accountManager.refreshExpiringTokens();
    if (nextDelay > 0) {
      browser.alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: nextDelay });
      console.log(`[Firefox Background] Next refresh alarm in ${nextDelay} minutes`);
    }
  }
});

// Initialize on install/startup
async function initialize() {
  console.log('[Firefox Background] Initializing...');

  // Run migration from single-account to multi-account
  const migrated = await accountManager.migrateFromSingleAccount();
  if (migrated) {
    console.log('[Firefox Background] Migration from single-account completed');
  }

  // Schedule proactive token refresh
  await scheduleTokenRefresh();

  // Check for updates
  const manifest = browser.runtime.getManifest();
  await checkForUpdates(manifest.version, browser.storage);
}

// Check for updates on startup
browser.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed/updated');
  await initialize();
});

// Also check on startup (when browser starts)
browser.runtime.onStartup.addListener(async () => {
  console.log('Browser started');
  await initialize();
});

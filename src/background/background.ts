// Chrome background script - owns Gmail fetches, OAuth, and resilient OTP request processing.

import { AccountManager, TOKEN_REFRESH_ALARM } from '../shared/account-manager';
import type { OtpFillResult } from '../content/otp-finder';

declare const __CHROME_CLIENT_ID__: string;
declare const __CHROME_CLIENT_SECRET__: string;

interface OTPResponse {
  success: boolean;
  otp?: string;
  error?: string;
}

interface AccountsResponse {
  accounts: Record<string, AccountInfo>;
  activeEmail: string | null;
}

interface AccountInfo {
  email: string;
  accessToken: string;
  accessTokenExpires: number;
  refreshToken?: string;
  grantedScopes?: string;
  addedAt: number;
  lastUsedAt: number;
}

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailSearchResponse {
  messages?: GmailMessage[];
}

interface GmailMessageResponse {
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{
      body: { data?: string };
      mimeType: string;
      parts?: Array<{
        body: { data?: string };
        mimeType: string;
      }>;
    }>;
    body?: { data?: string };
  };
  snippet?: string;
}

interface PendingOtpRequest {
  requestId: string;
  tabId?: number;
  frameIds: number[];
  websiteDomain: string;
  searchDomain: string;
  autoFill: boolean;
  createdAt: number;
  expiresAt: number;
}

interface LatestOtpResult {
  requestId: string;
  success: boolean;
  otp?: string;
  domain: string;
  message: string;
  autoFillResult?: OtpFillResult;
  accountEmail?: string | null;
  timestamp: number;
}

interface FetchOtpMessage {
  action: 'fetchOTP';
  domain: string;
  websiteDomain?: string;
  autoFill?: boolean;
  tabId?: number;
  frameIds?: number[];
  requestId?: string;
}

const LATEST_RESULT_KEY = 'latest_otp_result';
const PENDING_REQUEST_KEY = 'pending_otp_request';
const REQUEST_TTL_MS = 2 * 60 * 1000;

const chromeIdentity = {
  getRedirectURL: () => chrome.identity.getRedirectURL(),
  launchWebAuthFlow: (details: { url: string; interactive: boolean }): Promise<string> => {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(details, responseUrl => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(responseUrl || '');
        }
      });
    });
  }
};

const chromeStorage = {
  local: {
    get: (keys: string | string[]): Promise<Record<string, unknown>> => {
      return new Promise(resolve => {
        const get = chrome.storage.local.get as (storageKeys: string | string[], callback: (items: Record<string, unknown>) => void) => void;
        get(keys, resolve);
      });
    },
    set: (items: Record<string, unknown>): Promise<void> => {
      return new Promise(resolve => chrome.storage.local.set(items, resolve));
    },
    remove: (keys: string | string[]): Promise<void> => {
      return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
    }
  }
};

const accountManager = new AccountManager(
  chromeStorage,
  chromeIdentity,
  __CHROME_CLIENT_ID__,
  __CHROME_CLIENT_SECRET__
);

class GmailOTPFetcher {
  private readonly OTP_PATTERNS = [
    /verification code[:\s]*(\d{4,8})/gi,
    /security code[:\s]*(\d{4,8})/gi,
    /your code[:\s]*(\d{4,8})/gi,
    /otp[:\s]*(\d{4,8})/gi,
    /pin[:\s]*(\d{4,8})/gi,
    /\b(\d{6})\b/g,
    /\b(\d{4})\b/g,
    /\b(\d{8})\b/g
  ];

  public async fetchOTPForDomain(domain: string): Promise<OTPResponse> {
    try {
      console.log('[Chrome Background] Getting access token from AccountManager...');
      const tokenInfo = await accountManager.getActiveAccountToken();

      if (!tokenInfo) {
        const hasAccounts = await accountManager.hasAccounts();
        if (!hasAccounts) {
          return { success: false, error: 'No Gmail account configured. Click extension icon to add an account.' };
        }

        return { success: false, error: 'Gmail authentication expired. Please re-authenticate.' };
      }

      const { token, email } = tokenInfo;
      console.log('[Chrome Background] Using account:', email);

      const messages = await this.searchGmailMessages(token, email, domain);
      if (!messages || messages.length === 0) {
        return { success: false, error: `No recent emails found for ${domain}` };
      }

      for (const message of messages.slice(0, 5)) {
        const messageDetail = await this.getMessageDetail(token, email, message.id);
        const otp = this.extractOTP(messageDetail);
        if (otp) return { success: true, otp };
      }

      return { success: false, error: 'No OTP found in recent emails' };
    } catch (error) {
      console.error('[Chrome Background] Error fetching OTP:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  private async searchGmailMessages(token: string, userEmail: string, domain: string): Promise<GmailMessage[]> {
    const query = `from:${domain} OR from:@${domain} newer_than:30m`;
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages?q=${encodeURIComponent(query)}&maxResults=10`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[Chrome Background] Gmail API error body:', errorBody);
      throw new Error(`Gmail API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as GmailSearchResponse;
    return data.messages || [];
  }

  private async getMessageDetail(token: string, userEmail: string, messageId: string): Promise<GmailMessageResponse> {
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${messageId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status}`);
    }

    return await response.json() as GmailMessageResponse;
  }

  private extractOTP(message: GmailMessageResponse): string | null {
    const content = this.getMessageTextContent(message);
    const searchText = `${message.snippet || ''}\n${content}`;

    for (const pattern of this.OTP_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(searchText);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  private getMessageTextContent(message: GmailMessageResponse): string {
    const parts = message.payload.parts || [];
    const textParts: string[] = [];

    const collectText = (part: { body: { data?: string }; mimeType: string; parts?: Array<{ body: { data?: string }; mimeType: string }> }): void => {
      if (part.mimeType === 'text/plain' && part.body.data) {
        textParts.push(this.decodeBase64(part.body.data));
      }

      part.parts?.forEach(collectText);
    };

    parts.forEach(collectText);

    if (message.payload.body?.data) {
      textParts.push(this.decodeBase64(message.payload.body.data));
    }

    return textParts.join('\n');
  }

  private decodeBase64(data: string): string {
    try {
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(base64)));
    } catch (error) {
      console.error('Error decoding base64:', error);
      return '';
    }
  }
}

const otpFetcher = new GmailOTPFetcher();
const pendingOtpRequests = new Map<string, PendingOtpRequest>();

function generateRequestId(): string {
  return crypto.randomUUID?.() ?? `otp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createPendingRequest(message: FetchOtpMessage): PendingOtpRequest {
  const createdAt = Date.now();
  return {
    requestId: message.requestId || generateRequestId(),
    tabId: message.tabId,
    frameIds: Array.from(new Set(message.frameIds || [])).filter(frameId => frameId >= 0),
    websiteDomain: message.websiteDomain || message.domain,
    searchDomain: message.domain,
    autoFill: Boolean(message.autoFill && message.tabId),
    createdAt,
    expiresAt: createdAt + REQUEST_TTL_MS
  };
}

async function storePendingRequest(request: PendingOtpRequest): Promise<void> {
  pendingOtpRequests.set(request.requestId, request);
  await chromeStorage.local.set({ [PENDING_REQUEST_KEY]: request });
}

async function clearPendingRequest(requestId: string): Promise<void> {
  pendingOtpRequests.delete(requestId);

  const stored = await chromeStorage.local.get([PENDING_REQUEST_KEY]);
  const pending = stored[PENDING_REQUEST_KEY] as PendingOtpRequest | undefined;
  if (pending?.requestId === requestId) {
    await chromeStorage.local.remove(PENDING_REQUEST_KEY);
  }
}

async function storeLatestResult(result: LatestOtpResult): Promise<void> {
  await chromeStorage.local.set({ [LATEST_RESULT_KEY]: result });
}

async function sendOtpToBridge(request: PendingOtpRequest, otp: string): Promise<OtpFillResult> {
  if (!request.tabId) {
    return { success: false, strategy: 'none', reason: 'missing-tab' };
  }

  const frameIds = request.frameIds.length > 0 ? request.frameIds : [undefined];
  let lastError: unknown;

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(
        request.tabId,
        { action: 'fillOTP', otp },
        frameId === undefined ? undefined : { frameId }
      ) as OtpFillResult | undefined;

      if (response?.success) return response;
      lastError = response?.reason ?? 'bridge-returned-false';
    } catch (error) {
      lastError = error;
    }
  }

  if (request.frameIds.length > 0) {
    try {
      const response = await chrome.tabs.sendMessage(request.tabId, { action: 'fillOTP', otp }) as OtpFillResult | undefined;
      if (response?.success) return response;
      lastError = response?.reason ?? 'bridge-returned-false';
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'bridge-unavailable');
  return { success: false, strategy: 'none', reason };
}

function buildSuccessMessage(otp: string, request: PendingOtpRequest, fillResult?: OtpFillResult): string {
  if (!request.autoFill) return `OTP: ${otp} (ready to copy)`;
  if (fillResult?.success) return `OTP: ${otp} (auto-filled)`;
  return `OTP: ${otp} (found, auto-fill unavailable)`;
}

async function processOTPRequest(request: PendingOtpRequest): Promise<void> {
  console.log('[Chrome Background] Processing OTP request:', request);

  try {
    const result = await otpFetcher.fetchOTPForDomain(request.searchDomain);
    const activeEmail = await accountManager.getActiveAccountEmail();

    if (result.success && result.otp) {
      const fillResult = request.autoFill ? await sendOtpToBridge(request, result.otp) : undefined;

      await storeLatestResult({
        requestId: request.requestId,
        success: true,
        otp: result.otp,
        domain: request.searchDomain,
        message: buildSuccessMessage(result.otp, request, fillResult),
        autoFillResult: fillResult,
        accountEmail: activeEmail,
        timestamp: Date.now()
      });
    } else {
      await storeLatestResult({
        requestId: request.requestId,
        success: false,
        domain: request.searchDomain,
        message: result.error || `No OTP found in recent emails for ${request.searchDomain}`,
        accountEmail: activeEmail,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    await storeLatestResult({
      requestId: request.requestId,
      success: false,
      domain: request.searchDomain,
      message: `Error: ${(error as Error).message}`,
      timestamp: Date.now()
    });
  } finally {
    await clearPendingRequest(request.requestId);
  }
}

chrome.runtime.onMessage.addListener((message: { action?: string } & Record<string, unknown>, _sender, sendResponse) => {
  if (message.action === 'getAccounts') {
    (async () => {
      const accounts = await accountManager.getAllAccounts();
      const activeEmail = await accountManager.getActiveAccountEmail();
      sendResponse({ accounts, activeEmail } satisfies AccountsResponse);
    })();
    return true;
  }

  if (message.action === 'addAccount') {
    (async () => {
      const email = await accountManager.addAccount();
      if (email) await scheduleTokenRefresh();
      sendResponse({ success: Boolean(email), email });
    })();
    return true;
  }

  if (message.action === 'removeAccount') {
    (async () => {
      await accountManager.removeAccount(message.email as string);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === 'setActiveAccount') {
    (async () => {
      await accountManager.setActiveAccount(message.email as string);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === 'fetchOTP') {
    (async () => {
      const request = createPendingRequest(message as unknown as FetchOtpMessage);
      await storePendingRequest(request);
      void processOTPRequest(request).catch(error => {
        console.error('[Chrome Background] OTP request processing failed:', error);
      });
      sendResponse({ success: true, pending: true, requestId: request.requestId });
    })();
    return true;
  }

  return false;
});

// Inline version check (avoid ES module imports for Chrome).
async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const cached = await chromeStorage.local.get(['version_check']);
    const cachedVersion = cached.version_check as { lastChecked?: number } | undefined;
    if (cachedVersion?.lastChecked && Date.now() - cachedVersion.lastChecked < 24 * 60 * 60 * 1000) {
      return;
    }

    const response = await fetch('https://api.github.com/repos/jefe-johann/grab-otp/releases/latest', {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });

    if (!response.ok) {
      console.log('Version check: GitHub API returned', response.status);
      return;
    }

    const release = await response.json() as { tag_name?: string };
    const latestVersion = (release.tag_name || currentVersion).replace(/^v/, '');
    const currentParts = currentVersion.split('.').map((n: string) => parseInt(n, 10));
    const latestParts = latestVersion.split('.').map((n: string) => parseInt(n, 10));
    let updateAvailable = false;

    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i += 1) {
      const current = currentParts[i] || 0;
      const latest = latestParts[i] || 0;
      if (current < latest) {
        updateAvailable = true;
        break;
      }
      if (current > latest) break;
    }

    const versionInfo = {
      current: currentVersion,
      latest: latestVersion,
      updateAvailable,
      lastChecked: Date.now()
    };

    await chromeStorage.local.set({ version_check: versionInfo });
    console.log('Version check:', versionInfo);
  } catch (error) {
    console.log('Version check failed (non-critical):', error);
  }
}

async function scheduleTokenRefresh(): Promise<void> {
  const delayMinutes = await accountManager.getNextRefreshDelay();
  if (delayMinutes > 0) {
    chrome.alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: delayMinutes });
    console.log(`[Chrome Background] Token refresh alarm scheduled in ${delayMinutes} minutes`);
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === TOKEN_REFRESH_ALARM) {
    console.log('[Chrome Background] Token refresh alarm fired');
    const nextDelay = await accountManager.refreshExpiringTokens();
    if (nextDelay > 0) {
      chrome.alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: nextDelay });
      console.log(`[Chrome Background] Next refresh alarm in ${nextDelay} minutes`);
    }
  }
});

async function initialize(): Promise<void> {
  console.log('[Chrome Background] Initializing...');

  const migrated = await accountManager.migrateFromSingleAccount();
  if (migrated) {
    console.log('[Chrome Background] Migration from single-account completed');
  }

  await scheduleTokenRefresh();

  const manifest = chrome.runtime.getManifest();
  await checkForUpdates(manifest.version);
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed/updated');
  await initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Browser startup');
  await initialize();
});

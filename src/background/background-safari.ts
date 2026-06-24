// Safari background script.
// OAuth account creation is delegated to the Safari app extension via native messaging.

import type { AccountInfo } from '../shared/account-manager';
import { generateCodeChallenge, generateCodeVerifier, exchangeCodeForTokens } from '../shared/pkce';
import { GMAIL_SCOPE, REQUIRED_SCOPE, getTokenScopes, getUserEmail, refreshToken } from '../shared/oauth';
import { checkForUpdates } from '../shared/version-check';
import { getGmailMessageTextContent } from './gmail-message-text';
import { extractOtpFromText } from './otp-extractor';
import { buildSenderQuery } from './gmail-query';
import { fetchSmsOtpWithToken } from './sms-otp';

declare const __SAFARI_CLIENT_ID__: string;
declare const __SAFARI_APP_BUNDLE_ID__: string;

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

interface NativeOAuthResponse {
  success?: boolean;
  callbackUrl?: string;
  error?: string;
}

interface AddAccountResponse {
  success: boolean;
  email?: string;
  error?: string;
}

interface ExtensionMessage {
  action?: string;
  email?: string;
  domain?: string;
  source?: 'gmail' | 'sms';
}

interface SafariAlarm {
  name: string;
}

interface NativeOAuthMessage {
  action: 'beginGmailOAuth';
  provider: 'google';
  authUrl: string;
  callbackScheme: string;
  requestedAt: number;
}

interface SafariBrowser {
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  runtime: {
    sendNativeMessage?: (
      applicationOrMessage: string | NativeOAuthMessage,
      message?: NativeOAuthMessage
    ) => Promise<NativeOAuthResponse>;
    onMessage: {
      addListener(listener: (message: ExtensionMessage) => Promise<unknown> | unknown): void;
    };
    getManifest(): { version: string };
    onInstalled?: {
      addListener(listener: () => Promise<void> | void): void;
    };
    onStartup?: {
      addListener(listener: () => Promise<void> | void): void;
    };
  };
  alarms?: {
    create(name: string, alarmInfo: { delayInMinutes: number }): void;
    onAlarm?: {
      addListener(listener: (alarm: SafariAlarm) => Promise<void> | void): void;
    };
  };
}

declare const browser: SafariBrowser;

const STORAGE_KEY_ACCOUNTS = 'gmail_accounts';
const STORAGE_KEY_ACTIVE = 'active_account_email';
const TOKEN_REFRESH_ALARM = 'token-refresh';
const NATIVE_APP_ID = __SAFARI_APP_BUNDLE_ID__ || 'com.jeff.grabotp.safari.Extension';

class SafariAccountStore {
  async getAllAccounts(): Promise<Record<string, AccountInfo>> {
    const result = await browser.storage.local.get(STORAGE_KEY_ACCOUNTS);
    return result[STORAGE_KEY_ACCOUNTS] as Record<string, AccountInfo> || {};
  }

  async getActiveAccountEmail(): Promise<string | null> {
    const result = await browser.storage.local.get(STORAGE_KEY_ACTIVE);
    return result[STORAGE_KEY_ACTIVE] as string || null;
  }

  async getActiveAccount(): Promise<AccountInfo | null> {
    const result = await browser.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_ACTIVE]);
    const accounts = result[STORAGE_KEY_ACCOUNTS] as Record<string, AccountInfo> || {};
    const activeEmail = result[STORAGE_KEY_ACTIVE] as string | null;

    if (activeEmail && accounts[activeEmail]) {
      return accounts[activeEmail];
    }

    const fallbackEmail = Object.keys(accounts)[0];
    if (!fallbackEmail) {
      return null;
    }

    await this.setActiveAccount(fallbackEmail);
    return accounts[fallbackEmail];
  }

  async setActiveAccount(email: string): Promise<void> {
    const accounts = await this.getAllAccounts();
    if (!accounts[email]) {
      throw new Error(`Account ${email} not found`);
    }

    accounts[email].lastUsedAt = Date.now();
    await browser.storage.local.set({
      [STORAGE_KEY_ACCOUNTS]: accounts,
      [STORAGE_KEY_ACTIVE]: email
    });
  }

  async removeAccount(email: string): Promise<void> {
    const accounts = await this.getAllAccounts();
    if (!accounts[email]) {
      return;
    }

    delete accounts[email];
    await browser.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    const activeEmail = await this.getActiveAccountEmail();
    if (activeEmail === email) {
      const nextEmail = Object.keys(accounts)[0];
      if (nextEmail) {
        await this.setActiveAccount(nextEmail);
      } else {
        await browser.storage.local.remove(STORAGE_KEY_ACTIVE);
      }
    }
  }

  async hasAccounts(): Promise<boolean> {
    const accounts = await this.getAllAccounts();
    return Object.keys(accounts).length > 0;
  }

  async addAccountFromNative(): Promise<AddAccountResponse> {
    if (!__SAFARI_CLIENT_ID__) {
      return {
        success: false,
        error: 'Missing SAFARI_CLIENT_ID. Create a Google native app OAuth client for Safari and set SAFARI_CLIENT_ID before building.'
      };
    }

    try {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const callbackScheme = getGoogleNativeCallbackScheme(__SAFARI_CLIENT_ID__);
      const redirectUri = `${callbackScheme}:/oauth2redirect`;
      const authUrl = buildGoogleAuthUrl(__SAFARI_CLIENT_ID__, redirectUri, codeChallenge);
      const nativeResponse = await sendNativeOAuthMessage(authUrl, callbackScheme);

      if (!nativeResponse.success) {
        return {
          success: false,
          error: nativeResponse.error || 'Safari native OAuth did not return a callback URL.'
        };
      }

      if (!nativeResponse.callbackUrl) {
        return {
          success: false,
          error: 'Safari native OAuth completed without a callback URL.'
        };
      }

      const callbackUrl = new URL(nativeResponse.callbackUrl);
      const oauthError = callbackUrl.searchParams.get('error');
      if (oauthError) {
        return {
          success: false,
          error: `Google OAuth error: ${oauthError}`
        };
      }

      const code = callbackUrl.searchParams.get('code');
      if (!code) {
        return {
          success: false,
          error: 'Google OAuth completed without an authorization code.'
        };
      }

      const tokens = await exchangeCodeForTokens(
        code,
        codeVerifier,
        __SAFARI_CLIENT_ID__,
        redirectUri
      );

      if (!tokens) {
        return {
          success: false,
          error: `Google OAuth token exchange failed. Confirm SAFARI_CLIENT_ID is an installed/native Google OAuth client and that its authorized redirect URI is ${redirectUri}.`
        };
      }

      const tokenInfo = {
        accessToken: tokens.access_token,
        accessTokenExpires: Date.now() + ((tokens.expires_in - 300) * 1000),
        refreshToken: tokens.refresh_token,
        grantedScopes: tokens.scope
      };

      if (!await hasRequiredScope(tokenInfo)) {
        return {
          success: false,
          error: 'Google OAuth did not grant Gmail read access.'
        };
      }

      const email = await getUserEmail(tokens.access_token);
      if (!email) {
        return {
          success: false,
          error: 'Google OAuth succeeded, but the account email could not be read.'
        };
      }

      const accounts = await this.getAllAccounts();
      const existingAccount = accounts[email];

      if (!tokenInfo.refreshToken && !existingAccount?.refreshToken) {
        return {
          success: false,
          error: 'Google OAuth did not return a refresh token. Remove any existing Grab OTP consent from your Google account and try Add Gmail account again.'
        };
      }

      const now = Date.now();

      accounts[email] = {
        email,
        accessToken: tokenInfo.accessToken,
        accessTokenExpires: tokenInfo.accessTokenExpires,
        refreshToken: tokenInfo.refreshToken || existingAccount?.refreshToken,
        grantedScopes: tokenInfo.grantedScopes,
        addedAt: existingAccount?.addedAt || now,
        lastUsedAt: now
      };

      await browser.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

      const activeEmail = await this.getActiveAccountEmail();
      if (!activeEmail) {
        await this.setActiveAccount(email);
      }

      return { success: true, email };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async getActiveAccountToken(): Promise<{ token: string; email: string } | null> {
    const account = await this.getActiveAccount();
    if (!account) {
      return null;
    }

    if (account.accessTokenExpires > Date.now() + 60000) {
      return { token: account.accessToken, email: account.email };
    }

    if (!account.refreshToken) {
      return null;
    }

    const tokenData = await refreshToken(account.refreshToken, __SAFARI_CLIENT_ID__);
    if (!tokenData) {
      return null;
    }

    const accounts = await this.getAllAccounts();
    accounts[account.email] = {
      ...accounts[account.email],
      accessToken: tokenData.accessToken,
      accessTokenExpires: tokenData.accessTokenExpires,
      grantedScopes: tokenData.grantedScopes,
      lastUsedAt: Date.now()
    };
    await browser.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    return { token: tokenData.accessToken, email: account.email };
  }

  async refreshExpiringTokens(): Promise<number> {
    const accounts = await this.getAllAccounts();
    const now = Date.now();
    const refreshWindowMs = 10 * 60 * 1000;
    let nextExpiry = Infinity;

    for (const email of Object.keys(accounts)) {
      const account = accounts[email];
      if (account.accessTokenExpires < now + refreshWindowMs && account.refreshToken) {
        const tokenData = await refreshToken(account.refreshToken, __SAFARI_CLIENT_ID__);
        if (tokenData) {
          accounts[email] = {
            ...account,
            accessToken: tokenData.accessToken,
            accessTokenExpires: tokenData.accessTokenExpires,
            grantedScopes: tokenData.grantedScopes,
            lastUsedAt: now
          };
        }
      }

      if (accounts[email].accessTokenExpires > now) {
        nextExpiry = Math.min(nextExpiry, accounts[email].accessTokenExpires);
      }
    }

    await browser.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    if (nextExpiry === Infinity) {
      return 0;
    }

    return Math.max(1, Math.round((nextExpiry - now - (5 * 60 * 1000)) / 60000));
  }

  async getNextRefreshDelay(): Promise<number> {
    const accounts = await this.getAllAccounts();
    const now = Date.now();
    let nextExpiry = Infinity;

    for (const account of Object.values(accounts)) {
      if (account.accessTokenExpires > now) {
        nextExpiry = Math.min(nextExpiry, account.accessTokenExpires);
      }
    }

    if (nextExpiry === Infinity) {
      return 0;
    }

    return Math.max(1, Math.round((nextExpiry - now - (5 * 60 * 1000)) / 60000));
  }
}

function getGoogleNativeCallbackScheme(clientId: string): string {
  const suffix = '.apps.googleusercontent.com';
  if (!clientId.endsWith(suffix)) {
    throw new Error('SAFARI_CLIENT_ID must be a Google OAuth client ID ending in .apps.googleusercontent.com.');
  }

  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

function buildGoogleAuthUrl(clientId: string, redirectUri: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function hasRequiredScope(tokenInfo: { accessToken: string; grantedScopes?: string }): Promise<boolean> {
  const grantedScopes = tokenInfo.grantedScopes || await getTokenScopes(tokenInfo.accessToken);
  return grantedScopes?.split(' ').includes(REQUIRED_SCOPE) ?? false;
}

async function sendNativeOAuthMessage(authUrl: string, callbackScheme: string): Promise<NativeOAuthResponse> {
  const message: NativeOAuthMessage = {
    action: 'beginGmailOAuth',
    provider: 'google',
    authUrl,
    callbackScheme,
    requestedAt: Date.now()
  };

  if (!browser.runtime.sendNativeMessage) {
    return {
      success: false,
      error: 'Safari native messaging is not available in this browser context.'
    };
  }

  try {
    return await browser.runtime.sendNativeMessage(NATIVE_APP_ID, message);
  } catch (twoArgumentError) {
    try {
      return await browser.runtime.sendNativeMessage(message);
    } catch (singleArgumentError) {
      return {
        success: false,
        error: `Safari native OAuth bridge failed: ${(singleArgumentError as Error).message || (twoArgumentError as Error).message}`
      };
    }
  }
}

class SafariGmailOTPFetcher {

  constructor(private accountStore: SafariAccountStore) {}

  public async fetchOTPForDomain(domain: string): Promise<OTPResponse> {
    try {
      const tokenInfo = await this.accountStore.getActiveAccountToken();

      if (!tokenInfo) {
        const hasAccounts = await this.accountStore.hasAccounts();
        if (!hasAccounts) {
          return { success: false, error: 'No Gmail account configured. Click extension icon to add an account.' };
        }
        return { success: false, error: 'Gmail authentication expired. Please re-authenticate.' };
      }

      const messages = await this.searchGmailMessages(tokenInfo.token, tokenInfo.email, domain);
      if (!messages || messages.length === 0) {
        return { success: false, error: `No recent emails found for ${domain}` };
      }

      for (const message of messages.slice(0, 5)) {
        const messageDetail = await this.getMessageDetail(tokenInfo.token, tokenInfo.email, message.id);
        const otp = this.extractOTP(messageDetail);

        if (otp) {
          return { success: true, otp };
        }
      }

      return { success: false, error: 'No OTP found in recent emails' };
    } catch (error) {
      console.error('[Safari Background] Error fetching OTP:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // Domain-agnostic fetch for codes forwarded from SMS by the phone relay.
  public async fetchSmsOTP(): Promise<OTPResponse> {
    try {
      const tokenInfo = await this.accountStore.getActiveAccountToken();
      if (!tokenInfo) {
        const hasAccounts = await this.accountStore.hasAccounts();
        return {
          success: false,
          error: hasAccounts
            ? 'Gmail authentication expired. Please re-authenticate.'
            : 'No Gmail account configured. Click extension icon to add an account.'
        };
      }

      return await fetchSmsOtpWithToken(tokenInfo.token, tokenInfo.email);
    } catch (error) {
      console.error('[Safari Background] Error fetching SMS OTP:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  private async searchGmailMessages(token: string, userEmail: string, domain: string): Promise<GmailMessage[]> {
    const query = `${buildSenderQuery(domain)} newer_than:30m`;
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages?q=${encodeURIComponent(query)}&maxResults=10`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gmail API error: ${response.status} - ${errorBody}`);
    }

    const data: GmailSearchResponse = await response.json();
    return data.messages || [];
  }

  private async getMessageDetail(token: string, userEmail: string, messageId: string): Promise<GmailMessageResponse> {
    const url = `https://www.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${messageId}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
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

const accountStore = new SafariAccountStore();
const otpFetcher = new SafariGmailOTPFetcher(accountStore);

browser.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'getAccounts') {
    const accounts = await accountStore.getAllAccounts();
    const activeEmail = await accountStore.getActiveAccountEmail();
    return { accounts, activeEmail };
  }

  if (message.action === 'addAccount') {
    const response = await accountStore.addAccountFromNative();
    if (response.success) {
      await scheduleTokenRefresh();
    }
    return response;
  }

  if (message.action === 'removeAccount') {
    if (!message.email) {
      return { success: false, error: 'Missing account email.' };
    }
    await accountStore.removeAccount(message.email);
    return { success: true };
  }

  if (message.action === 'setActiveAccount') {
    if (!message.email) {
      return { success: false, error: 'Missing account email.' };
    }
    await accountStore.setActiveAccount(message.email);
    return { success: true };
  }

  if (message.action === 'fetchOTP') {
    if (message.source === 'sms') {
      return otpFetcher.fetchSmsOTP();
    }
    if (!message.domain) {
      return { success: false, error: 'Missing request domain.' };
    }
    return otpFetcher.fetchOTPForDomain(message.domain);
  }
});

async function scheduleTokenRefresh(): Promise<void> {
  if (!browser.alarms) {
    return;
  }

  const delayMinutes = await accountStore.getNextRefreshDelay();
  if (delayMinutes > 0) {
    browser.alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: delayMinutes });
  }
}

const alarms = browser.alarms;
if (alarms?.onAlarm) {
  alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === TOKEN_REFRESH_ALARM) {
      const nextDelay = await accountStore.refreshExpiringTokens();
      if (nextDelay > 0) {
        alarms.create(TOKEN_REFRESH_ALARM, { delayInMinutes: nextDelay });
      }
    }
  });
}

async function initialize(): Promise<void> {
  await scheduleTokenRefresh();
  const manifest = browser.runtime.getManifest();
  await checkForUpdates(manifest.version, browser.storage);
}

browser.runtime.onInstalled?.addListener(async () => {
  await initialize();
});

browser.runtime.onStartup?.addListener(async () => {
  await initialize();
});

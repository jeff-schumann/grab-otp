// Account Manager for multi-account Gmail support
// Handles storage, retrieval, and management of multiple Gmail accounts

import { performPKCEAuth, attemptSilentAuth, refreshToken, getUserEmail, getGmailProfileEmail, getTokenEmail, getTokenScopes, OAuthConfig, TokenData, REQUIRED_SCOPE } from './oauth';

export interface AccountInfo {
  email: string;
  accessToken: string;
  accessTokenExpires: number;
  refreshToken?: string;
  grantedScopes?: string;
  addedAt: number;
  lastUsedAt: number;
}

export interface AccountStorage {
  accounts: Record<string, AccountInfo>;
  activeAccountEmail: string | null;
}

// Storage keys
const STORAGE_KEY_ACCOUNTS = 'gmail_accounts';
const STORAGE_KEY_ACTIVE = 'active_account_email';

// Legacy storage keys (for migration)
const LEGACY_OAUTH_TOKEN = 'oauth_token';
const LEGACY_OAUTH_EXPIRES = 'oauth_expires';
const LEGACY_REFRESH_TOKEN = 'oauth_refresh_token';

type StorageAPI = {
  local: {
    get: (keys: string | string[]) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
};

export const TOKEN_REFRESH_ALARM = 'token-refresh';

type IdentityAPI = {
  getRedirectURL: () => string;
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string>;
};

export class AccountManager {
  private storage: StorageAPI;
  private identity: IdentityAPI;
  private oauthConfig: OAuthConfig;
  private interactiveAuthPromise: Promise<TokenData | null> | null = null;

  constructor(
    storage: StorageAPI,
    identity: IdentityAPI,
    clientId: string,
    clientSecret?: string
  ) {
    this.storage = storage;
    this.identity = identity;
    this.oauthConfig = {
      clientId,
      clientSecret,
      redirectUri: identity.getRedirectURL()
    };
  }

  /**
   * Launch the interactive PKCE flow, ensuring only one auth window exists at
   * a time. Concurrent callers share the in-flight flow's result instead of
   * queueing a second sign-in window behind the first one.
   */
  private runInteractiveAuth(): Promise<TokenData | null> {
    if (!this.interactiveAuthPromise) {
      this.interactiveAuthPromise = performPKCEAuth(
        this.oauthConfig,
        (details) => this.identity.launchWebAuthFlow(details)
      ).finally(() => {
        this.interactiveAuthPromise = null;
      });
    }
    return this.interactiveAuthPromise;
  }

  /**
   * Resolve the email for an access token. The userinfo endpoint can fail
   * transiently right after an auth flow; tokeninfo is a separate endpoint
   * that also reports the account email.
   */
  private async resolveEmail(accessToken: string): Promise<string | null> {
    const gmailEmail = await getGmailProfileEmail(accessToken);
    if (gmailEmail) return gmailEmail;

    const email = await getUserEmail(accessToken);
    if (email) return email;
    return getTokenEmail(accessToken);
  }

  /**
   * Get all stored accounts
   */
  async getAllAccounts(): Promise<Record<string, AccountInfo>> {
    const result = await this.storage.local.get(STORAGE_KEY_ACCOUNTS);
    return (result[STORAGE_KEY_ACCOUNTS] as Record<string, AccountInfo>) || {};
  }

  /**
   * Get a specific account by email
   */
  async getAccount(email: string): Promise<AccountInfo | null> {
    const accounts = await this.getAllAccounts();
    return accounts[email] || null;
  }

  /**
   * Get the currently active account
   */
  async getActiveAccount(): Promise<AccountInfo | null> {
    const result = await this.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_ACTIVE]);
    const accounts = (result[STORAGE_KEY_ACCOUNTS] as Record<string, AccountInfo>) || {};
    const activeEmail = result[STORAGE_KEY_ACTIVE] as string | null;

    if (!activeEmail || !accounts[activeEmail]) {
      // If no active account set, return the first account or null
      const emails = Object.keys(accounts);
      if (emails.length > 0) {
        await this.setActiveAccount(emails[0]);
        return accounts[emails[0]];
      }
      return null;
    }

    return accounts[activeEmail];
  }

  /**
   * Get the email of the currently active account
   */
  async getActiveAccountEmail(): Promise<string | null> {
    const result = await this.storage.local.get(STORAGE_KEY_ACTIVE);
    return (result[STORAGE_KEY_ACTIVE] as string) || null;
  }

  /**
   * Set the active account
   */
  async setActiveAccount(email: string): Promise<void> {
    const accounts = await this.getAllAccounts();
    if (!accounts[email]) {
      throw new Error(`Account ${email} not found`);
    }

    // Update last used timestamp
    accounts[email].lastUsedAt = Date.now();

    await this.storage.local.set({
      [STORAGE_KEY_ACCOUNTS]: accounts,
      [STORAGE_KEY_ACTIVE]: email
    });

    console.log('[AccountManager] Active account set to:', email);
  }

  /**
   * Add a new account via OAuth flow
   * Returns the email of the newly added account, or null on failure
   */
  async addAccount(): Promise<string | null> {
    console.log('[AccountManager] Starting OAuth flow to add new account...');

    // Perform PKCE auth with account selection
    const tokenData = await this.runInteractiveAuth();

    if (!tokenData) {
      console.log('[AccountManager] OAuth flow failed');
      return null;
    }

    // Validate scopes before storing
    if (!await this.hasRequiredScope(tokenData)) {
      console.error('[AccountManager] Token lacks required scope — aborting addAccount');
      return null;
    }

    // Get the user's email from Gmail after scope validation.
    const email = await this.resolveEmail(tokenData.accessToken);
    if (!email) {
      console.error('[AccountManager] Failed to get user email after auth');
      return null;
    }

    // Store the account
    const accounts = await this.getAllAccounts();
    const existingAccount = accounts[email];
    const now = Date.now();

    accounts[email] = {
      email,
      accessToken: tokenData.accessToken,
      accessTokenExpires: tokenData.accessTokenExpires,
      // Keep an existing refresh token if Google doesn't return one during re-auth.
      refreshToken: tokenData.refreshToken || existingAccount?.refreshToken,
      grantedScopes: tokenData.grantedScopes,
      addedAt: existingAccount?.addedAt || now, // Preserve original add date if re-authenticating
      lastUsedAt: now
    };

    await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    // If this is the first account, make it active
    const activeEmail = await this.getActiveAccountEmail();
    if (!activeEmail) {
      await this.setActiveAccount(email);
    }

    console.log('[AccountManager] Account added/updated:', email,
      '| refreshToken:', accounts[email].refreshToken ? 'present' : 'MISSING (token refresh will not work)');
    return email;
  }

  /**
   * Remove an account
   */
  async removeAccount(email: string): Promise<void> {
    const accounts = await this.getAllAccounts();

    if (!accounts[email]) {
      return; // Account doesn't exist
    }

    delete accounts[email];
    await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    // If we removed the active account, switch to another or clear
    const activeEmail = await this.getActiveAccountEmail();
    if (activeEmail === email) {
      const remainingEmails = Object.keys(accounts);
      if (remainingEmails.length > 0) {
        await this.setActiveAccount(remainingEmails[0]);
      } else {
        await this.storage.local.remove(STORAGE_KEY_ACTIVE);
      }
    }

    console.log('[AccountManager] Account removed:', email);
  }

  /**
   * Get a valid access token for a specific account
   * Automatically refreshes if needed
   */
  async getValidToken(email: string): Promise<string | null> {
    const account = await this.getAccount(email);

    if (!account) {
      console.log('[AccountManager] Account not found:', email);
      return null;
    }

    // Check if current token is still valid (with 1 minute buffer)
    if (account.accessTokenExpires > Date.now() + 60000) {
      return account.accessToken;
    }

    console.log('[AccountManager] Token expired for', email, ', attempting refresh...');

    // Try to refresh the token
    if (account.refreshToken) {
      const newTokenData = await refreshToken(
        account.refreshToken,
        this.oauthConfig.clientId,
        this.oauthConfig.clientSecret
      );

      if (newTokenData) {
        if (!await this.hasRequiredScope(newTokenData)) {
          console.warn('[AccountManager] Refreshed token lacks required scope for:', email, '— falling through to silent auth');
        } else {
          // Update stored token
          const accounts = await this.getAllAccounts();
          accounts[email] = {
            ...accounts[email],
            accessToken: newTokenData.accessToken,
            accessTokenExpires: newTokenData.accessTokenExpires,
            grantedScopes: newTokenData.grantedScopes,
            lastUsedAt: Date.now()
          };
          await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

          console.log('[AccountManager] Token refreshed for:', email);
          return newTokenData.accessToken;
        }
      }

      console.log('[AccountManager] Token refresh failed for:', email);
    }

    // If refresh failed or no refresh token, try silent auth
    console.log('[AccountManager] Attempting silent auth for:', email);
    const silentTokenData = await attemptSilentAuth(
      this.oauthConfig,
      (details) => this.identity.launchWebAuthFlow(details)
    );

    if (silentTokenData) {
      if (!await this.hasRequiredScope(silentTokenData)) {
        console.warn('[AccountManager] Silent auth token lacks required scope for:', email, '— falling through to interactive re-auth');
      } else {
        // Verify this is the same account.
        const silentEmail = await this.resolveEmail(silentTokenData.accessToken);
        if (silentEmail === email) {
          // Update stored token
          const accounts = await this.getAllAccounts();
          accounts[email] = {
            ...accounts[email],
            accessToken: silentTokenData.accessToken,
            accessTokenExpires: silentTokenData.accessTokenExpires,
            grantedScopes: silentTokenData.grantedScopes,
            lastUsedAt: Date.now()
          };
          await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

          console.log('[AccountManager] Silent auth succeeded for:', email);
          return silentTokenData.accessToken;
        }
      }
    }

    // Another caller may have completed an interactive auth while this one was
    // failing the silent paths — re-check storage before opening a new window.
    const refreshedAccount = await this.getAccount(email);
    if (refreshedAccount && refreshedAccount.accessTokenExpires > Date.now() + 60000) {
      return refreshedAccount.accessToken;
    }

    // Try interactive re-authentication as last resort
    console.log('[AccountManager] Attempting interactive re-authentication for:', email);
    const interactiveTokenData = await this.runInteractiveAuth();

    if (interactiveTokenData) {
      if (!await this.hasRequiredScope(interactiveTokenData)) {
        console.error('[AccountManager] Interactive re-auth token lacks required scope for:', email);
        return null;
      }

      // Verify this is the same account. A failed email lookup must not
      // discard a successful grant — assume the account we asked to re-auth.
      const newEmail = await this.resolveEmail(interactiveTokenData.accessToken) ?? email;

      if (newEmail === email) {
        // Same account - update stored token
        const accounts = await this.getAllAccounts();
        accounts[email] = {
          ...accounts[email],
          accessToken: interactiveTokenData.accessToken,
          accessTokenExpires: interactiveTokenData.accessTokenExpires,
          refreshToken: interactiveTokenData.refreshToken || accounts[email].refreshToken,
          grantedScopes: interactiveTokenData.grantedScopes,
          lastUsedAt: Date.now()
        };
        await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

        console.log('[AccountManager] Interactive re-auth succeeded for:', email);
        return interactiveTokenData.accessToken;
      } else {
        // Different account selected - add it as new account
        console.log('[AccountManager] User selected different account:', newEmail, 'instead of:', email);
        const accounts = await this.getAllAccounts();
        const now = Date.now();

        accounts[newEmail] = {
          email: newEmail,
          accessToken: interactiveTokenData.accessToken,
          accessTokenExpires: interactiveTokenData.accessTokenExpires,
          refreshToken: interactiveTokenData.refreshToken,
          grantedScopes: interactiveTokenData.grantedScopes,
          addedAt: accounts[newEmail]?.addedAt || now,
          lastUsedAt: now
        };
        await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

        // Switch to the newly authenticated account
        await this.setActiveAccount(newEmail);
        console.log('[AccountManager] Switched active account to:', newEmail);
        return interactiveTokenData.accessToken;
      }
    }

    console.log('[AccountManager] All re-authentication attempts failed for:', email);
    return null;
  }

  /**
   * Get a valid token for the active account
   */
  async getActiveAccountToken(): Promise<{ token: string; email: string } | null> {
    const activeAccount = await this.getActiveAccount();
    if (!activeAccount) {
      return null;
    }

    const token = await this.getValidToken(activeAccount.email);
    if (!token) {
      return null;
    }

    return { token, email: activeAccount.email };
  }

  /**
   * Check if any accounts exist
   */
  async hasAccounts(): Promise<boolean> {
    const accounts = await this.getAllAccounts();
    return Object.keys(accounts).length > 0;
  }

  /**
   * Get account count
   */
  async getAccountCount(): Promise<number> {
    const accounts = await this.getAllAccounts();
    return Object.keys(accounts).length;
  }

  /**
   * Migrate from single-account storage to multi-account storage
   * This should be called once during extension upgrade
   */
  async migrateFromSingleAccount(): Promise<boolean> {
    // Check if we already have multi-account storage
    const accounts = await this.getAllAccounts();
    if (Object.keys(accounts).length > 0) {
      console.log('[AccountManager] Already migrated to multi-account storage');
      return false;
    }

    // Check for legacy tokens
    const legacy = await this.storage.local.get([
      LEGACY_OAUTH_TOKEN,
      LEGACY_OAUTH_EXPIRES,
      LEGACY_REFRESH_TOKEN
    ]);

    const legacyToken = legacy[LEGACY_OAUTH_TOKEN] as string | undefined;
    const legacyExpires = legacy[LEGACY_OAUTH_EXPIRES] as number | undefined;
    const legacyRefresh = legacy[LEGACY_REFRESH_TOKEN] as string | undefined;

    if (!legacyToken) {
      console.log('[AccountManager] No legacy tokens to migrate');
      return false;
    }

    console.log('[AccountManager] Found legacy tokens, migrating...');

    // Try to get email from the token
    let email: string | null = null;

    // If token isn't expired, try to get email
    if (
      legacyExpires &&
      legacyExpires > Date.now() &&
      await this.hasRequiredScope({ accessToken: legacyToken })
    ) {
      email = await this.resolveEmail(legacyToken);
    }

    // If we couldn't get email and have refresh token, try refreshing first
    if (!email && legacyRefresh) {
      const newTokenData = await refreshToken(
        legacyRefresh,
        this.oauthConfig.clientId,
        this.oauthConfig.clientSecret
      );
      if (newTokenData && await this.hasRequiredScope(newTokenData)) {
        email = await this.resolveEmail(newTokenData.accessToken);
        if (email) {
          // Use the refreshed token
          const now = Date.now();
          const newAccounts: Record<string, AccountInfo> = {
            [email]: {
              email,
              accessToken: newTokenData.accessToken,
              accessTokenExpires: newTokenData.accessTokenExpires,
              refreshToken: legacyRefresh,
              addedAt: now,
              lastUsedAt: now
            }
          };

          await this.storage.local.set({
            [STORAGE_KEY_ACCOUNTS]: newAccounts,
            [STORAGE_KEY_ACTIVE]: email
          });

          // Clean up legacy storage
          await this.storage.local.remove([
            LEGACY_OAUTH_TOKEN,
            LEGACY_OAUTH_EXPIRES,
            LEGACY_REFRESH_TOKEN
          ]);

          console.log('[AccountManager] Migration complete for:', email);
          return true;
        }
      }
    }

    if (email) {
      // Migrate with existing token
      const now = Date.now();
      const newAccounts: Record<string, AccountInfo> = {
        [email]: {
          email,
          accessToken: legacyToken,
          accessTokenExpires: legacyExpires || (now + 3600000), // Default 1 hour if unknown
          refreshToken: legacyRefresh,
          addedAt: now,
          lastUsedAt: now
        }
      };

      await this.storage.local.set({
        [STORAGE_KEY_ACCOUNTS]: newAccounts,
        [STORAGE_KEY_ACTIVE]: email
      });

      // Clean up legacy storage
      await this.storage.local.remove([
        LEGACY_OAUTH_TOKEN,
        LEGACY_OAUTH_EXPIRES,
        LEGACY_REFRESH_TOKEN
      ]);

      console.log('[AccountManager] Migration complete for:', email);
      return true;
    }

    // Couldn't determine email - user will need to re-authenticate
    console.log('[AccountManager] Could not determine email from legacy token, clearing legacy data');
    await this.storage.local.remove([
      LEGACY_OAUTH_TOKEN,
      LEGACY_OAUTH_EXPIRES,
      LEGACY_REFRESH_TOKEN
    ]);

    return false;
  }

  /**
   * Update OAuth config (useful if client ID changes)
   */
  updateConfig(clientId: string, clientSecret?: string): void {
    this.oauthConfig = {
      clientId,
      clientSecret,
      redirectUri: this.identity.getRedirectURL()
    };
  }

  /**
   * Check whether a token includes the required Gmail scope.
   * Falls back to the tokeninfo API if scope data is missing.
   * Returns false when scope cannot be determined (safe default).
   */
  private async hasRequiredScope(tokenData: Pick<TokenData, 'accessToken' | 'grantedScopes'>): Promise<boolean> {
    let scopes = tokenData.grantedScopes;

    if (!scopes) {
      scopes = await getTokenScopes(tokenData.accessToken) ?? undefined;
    }

    if (!scopes) {
      console.warn('[AccountManager] Could not determine token scopes — rejecting token');
      return false;
    }

    const hasScope = scopes.split(' ').includes(REQUIRED_SCOPE);
    if (!hasScope) {
      console.warn('[AccountManager] Token lacks required scope:', REQUIRED_SCOPE, '— granted:', scopes);
    }
    return hasScope;
  }

  /**
   * Proactively refresh tokens that are about to expire.
   * Called by alarm handler in background scripts.
   * Returns the delay in minutes until the next refresh should be scheduled.
   */
  async refreshExpiringTokens(): Promise<number> {
    const accounts = await this.getAllAccounts();
    const emails = Object.keys(accounts);

    if (emails.length === 0) {
      console.log('[AccountManager] No accounts to refresh');
      return 0;
    }

    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;
    let earliestExpiry = Infinity;

    for (const email of emails) {
      const account = accounts[email];

      // Refresh any token expiring within 10 minutes
      if (account.accessTokenExpires < now + TEN_MINUTES && account.refreshToken) {
        console.log('[AccountManager] Proactively refreshing token for:', email);
        const newTokenData = await refreshToken(
          account.refreshToken,
          this.oauthConfig.clientId,
          this.oauthConfig.clientSecret
        );

        if (newTokenData) {
          if (!await this.hasRequiredScope(newTokenData)) {
            console.warn('[AccountManager] Proactively refreshed token lacks required scope for:', email, '— keeping existing token');
          } else {
            accounts[email] = {
              ...accounts[email],
              accessToken: newTokenData.accessToken,
              accessTokenExpires: newTokenData.accessTokenExpires,
              grantedScopes: newTokenData.grantedScopes,
              lastUsedAt: now
            };
            console.log('[AccountManager] Proactive refresh succeeded for:', email);
          }
        } else {
          console.log('[AccountManager] Proactive refresh failed for:', email);
        }
      }

      // Track the earliest expiry for scheduling the next alarm
      if (accounts[email].accessTokenExpires > now) {
        earliestExpiry = Math.min(earliestExpiry, accounts[email].accessTokenExpires);
      }
    }

    // Save any updated tokens
    await this.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });

    // Return minutes until 5 min before earliest expiry (minimum 1 minute)
    if (earliestExpiry === Infinity) {
      return 0;
    }
    const msUntilRefresh = earliestExpiry - now - (5 * 60 * 1000);
    return Math.max(1, Math.round(msUntilRefresh / 60000));
  }

  /**
   * Calculate delay in minutes for the next token refresh alarm.
   * Returns 0 if no accounts need refresh scheduling.
   */
  async getNextRefreshDelay(): Promise<number> {
    const accounts = await this.getAllAccounts();
    const now = Date.now();
    let earliestExpiry = Infinity;

    for (const email of Object.keys(accounts)) {
      const expiry = accounts[email].accessTokenExpires;
      if (expiry > now) {
        earliestExpiry = Math.min(earliestExpiry, expiry);
      }
    }

    if (earliestExpiry === Infinity) {
      return 0;
    }

    // Schedule 5 minutes before expiry, minimum 1 minute from now
    const msUntilRefresh = earliestExpiry - now - (5 * 60 * 1000);
    return Math.max(1, Math.round(msUntilRefresh / 60000));
  }
}

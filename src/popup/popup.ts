// Chrome popup controller.

type ExtensionApi = typeof chrome;

interface AccountInfo {
  email: string;
  accessToken: string;
  accessTokenExpires: number;
  refreshToken?: string;
  grantedScopes?: string;
  addedAt: number;
  lastUsedAt: number;
}

interface AccountsResponse {
  accounts: Record<string, AccountInfo>;
  activeEmail: string | null;
}

interface OtpFillResult {
  success: boolean;
  strategy: 'segmented' | 'single' | 'focused' | 'none';
  reason?: string;
  score?: number;
}

interface LatestOtpResult {
  requestId?: string;
  success: boolean;
  otp?: string;
  domain: string;
  message?: string;
  autoFillResult?: OtpFillResult;
  accountEmail?: string | null;
  timestamp: number;
}

interface InFlightRequest {
  requestId: string;
  websiteDomain: string;
  startedAt: number;
}

interface FetchOtpStartResponse {
  success: boolean;
  requestId?: string;
  result?: LatestOtpResult;
  error?: string;
}

type DomainOverrides = Record<string, string>;

interface VersionInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  lastChecked: number;
}

const extensionGlobal = globalThis as typeof globalThis & {
  chrome?: ExtensionApi;
  browser?: ExtensionApi;
};

const extensionApi = (extensionGlobal.chrome ?? extensionGlobal.browser) as ExtensionApi;
const LATEST_RESULT_KEY = 'latest_otp_result';
const IN_FLIGHT_KEY = 'otp_request_in_flight';
const RESULT_TTL_MS = 60 * 1000;

class PopupController {
  private statusElement: HTMLElement;
  private grabButton: HTMLButtonElement;
  private domainElement: HTMLElement;
  private autoFillCheckbox: HTMLInputElement;
  private updateBanner: HTMLElement;
  private updateMessage: HTMLElement;
  private settingsToggle: HTMLButtonElement;
  private overridePanel: HTMLElement;
  private overrideInput: HTMLInputElement;
  private clearOverrideBtn: HTMLButtonElement;
  private overrideStatus: HTMLElement;
  private accountEmail: HTMLElement;
  private accountDropdownToggle: HTMLButtonElement;
  private accountDropdown: HTMLElement;
  private accountList: HTMLElement;
  private addAccountBtn: HTMLButtonElement;
  private currentWebsiteDomain = '';
  private isDropdownOpen = false;
  private handledRequestId: string | null = null;
  private inFlightSafetyTimer: number | null = null;

  constructor() {
    this.statusElement = document.getElementById('status')!;
    this.grabButton = document.getElementById('grabOTP') as HTMLButtonElement;
    this.domainElement = document.getElementById('currentDomain')!;
    this.autoFillCheckbox = document.getElementById('autoFillEnabled') as HTMLInputElement;
    this.updateBanner = document.getElementById('updateBanner')!;
    this.updateMessage = document.getElementById('updateMessage')!;
    this.settingsToggle = document.getElementById('settingsToggle') as HTMLButtonElement;
    this.overridePanel = document.getElementById('domainOverridePanel')!;
    this.overrideInput = document.getElementById('overrideDomain') as HTMLInputElement;
    this.clearOverrideBtn = document.getElementById('clearOverride') as HTMLButtonElement;
    this.overrideStatus = document.getElementById('overrideStatus')!;
    this.accountEmail = document.getElementById('accountEmail')!;
    this.accountDropdownToggle = document.getElementById('accountDropdownToggle') as HTMLButtonElement;
    this.accountDropdown = document.getElementById('accountDropdown')!;
    this.accountList = document.getElementById('accountList')!;
    this.addAccountBtn = document.getElementById('addAccountBtn') as HTMLButtonElement;

    this.init();
  }

  private async init(): Promise<void> {
    // React the moment the background stores a result. This is what lets a
    // request interrupted by re-auth (which closed the popup) finish on its own
    // when the popup is reopened, instead of needing a second click.
    extensionApi.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const updated = changes[LATEST_RESULT_KEY]?.newValue as LatestOtpResult | undefined;
      if (updated) void this.renderResult(updated);
    });

    await this.loadAccounts();
    await this.restoreRequestState();
    await this.checkForUpdates();
    await this.displayCurrentDomain();
    await this.loadAutoFillPreference();

    this.grabButton.addEventListener('click', () => this.handleGrabOTP());
    this.autoFillCheckbox.addEventListener('change', () => this.saveAutoFillPreference());
    this.settingsToggle.addEventListener('click', () => this.toggleOverridePanel());
    this.overrideInput.addEventListener('blur', () => this.handleOverrideChange());
    this.overrideInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.overrideInput.blur();
    });
    this.clearOverrideBtn.addEventListener('click', () => this.handleClearOverride());
    this.accountDropdownToggle.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleAccountDropdown();
    });
    this.addAccountBtn.addEventListener('click', () => this.handleAddAccount());
    document.addEventListener('click', event => {
      const target = event.target as Node;
      const accountRow = document.getElementById('accountRow');
      if (this.isDropdownOpen && !this.accountDropdown.contains(target) && !accountRow?.contains(target)) {
        this.closeAccountDropdown();
      }
    });
  }

  private async loadAccounts(): Promise<void> {
    try {
      const response = await extensionApi.runtime.sendMessage({ action: 'getAccounts' }) as AccountsResponse;
      this.renderAccounts(response.accounts, response.activeEmail);
    } catch (error) {
      console.error('Error loading accounts:', error);
      this.accountEmail.textContent = 'Error loading accounts';
      this.accountEmail.classList.add('no-account');
    }
  }

  private renderAccounts(accounts: Record<string, AccountInfo>, activeEmail: string | null): void {
    const emails = Object.keys(accounts);
    const visibleEmail = activeEmail && accounts[activeEmail] ? activeEmail : emails[0];

    if (visibleEmail) {
      this.accountEmail.textContent = visibleEmail;
      this.accountEmail.classList.remove('no-account');
    } else {
      this.accountEmail.textContent = 'No account connected';
      this.accountEmail.classList.add('no-account');
    }

    this.accountList.replaceChildren();

    emails.forEach(email => {
      const item = document.createElement('div');
      item.className = `account-item${email === activeEmail ? ' active' : ''}`;

      const check = document.createElement('span');
      check.className = 'account-item-check';
      check.textContent = email === activeEmail ? '✓' : '';

      const label = document.createElement('span');
      label.className = 'account-item-email';
      label.textContent = email;

      const removeButton = document.createElement('button');
      removeButton.className = 'account-remove-btn';
      removeButton.title = 'Remove account';
      removeButton.dataset.email = email;
      removeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      removeButton.addEventListener('click', event => {
        event.stopPropagation();
        this.handleRemoveAccount(email);
      });

      item.append(check, label, removeButton);
      item.addEventListener('click', () => this.handleSwitchAccount(email));
      this.accountList.appendChild(item);
    });
  }

  private toggleAccountDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.accountDropdown.style.display = this.isDropdownOpen ? 'block' : 'none';
    this.accountDropdownToggle.classList.toggle('open', this.isDropdownOpen);
  }

  private closeAccountDropdown(): void {
    this.isDropdownOpen = false;
    this.accountDropdown.style.display = 'none';
    this.accountDropdownToggle.classList.remove('open');
  }

  private async handleAddAccount(): Promise<void> {
    this.closeAccountDropdown();
    this.showStatus('Opening Google sign-in...', 'loading');

    try {
      const response = await extensionApi.runtime.sendMessage({ action: 'addAccount' }) as { success: boolean; email?: string; error?: string };
      if (response.success) {
        this.showStatus(`Added account: ${response.email}`, 'success');
        await this.loadAccounts();
      } else {
        this.showStatus(response.error || 'Failed to add account', 'error');
      }
    } catch (error) {
      console.error('Error adding account:', error);
      this.showStatus('Error adding account', 'error');
    }
  }

  private async handleSwitchAccount(email: string): Promise<void> {
    this.closeAccountDropdown();
    try {
      await extensionApi.runtime.sendMessage({ action: 'setActiveAccount', email });
      await this.loadAccounts();
    } catch (error) {
      console.error('Error switching account:', error);
      this.showStatus('Error switching account', 'error');
    }
  }

  private async handleRemoveAccount(email: string): Promise<void> {
    if (!confirm(`Remove account ${email}?`)) return;

    try {
      await extensionApi.runtime.sendMessage({ action: 'removeAccount', email });
      await this.loadAccounts();
    } catch (error) {
      console.error('Error removing account:', error);
      this.showStatus('Error removing account', 'error');
    }
  }

  private async displayCurrentDomain(): Promise<void> {
    try {
      const tab = await this.getActiveTab();
      const tabUrl = tab.url || tab.pendingUrl;
      if (!tabUrl) throw new Error('No tab URL available');

      this.currentWebsiteDomain = new URL(tabUrl).hostname;
      const override = await this.getOverride(this.currentWebsiteDomain);

      if (override) {
        this.domainElement.textContent = `Searching: ${override}`;
        this.overrideInput.value = override;
        this.overrideStatus.textContent = `Override for ${this.currentWebsiteDomain}`;
      } else {
        this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
        this.overrideInput.value = '';
        this.overrideStatus.textContent = '';
      }
    } catch (error) {
      console.error('Error getting current domain:', error);
      this.domainElement.textContent = 'Unable to detect current site';
      this.settingsToggle.style.display = 'none';
    }
  }

  private async loadAutoFillPreference(): Promise<void> {
    try {
      const result = await extensionApi.storage.local.get(['autoFillEnabled']) as { autoFillEnabled?: boolean };
      this.autoFillCheckbox.checked = result.autoFillEnabled ?? true;
    } catch (error) {
      console.error('Error loading auto-fill preference:', error);
      this.autoFillCheckbox.checked = true;
    }
  }

  private async saveAutoFillPreference(): Promise<void> {
    try {
      await extensionApi.storage.local.set({ autoFillEnabled: this.autoFillCheckbox.checked });
    } catch (error) {
      console.error('Error saving auto-fill preference:', error);
    }
  }

  private async handleGrabOTP(): Promise<void> {
    try {
      const accounts = await extensionApi.runtime.sendMessage({ action: 'getAccounts' }) as AccountsResponse;
      if (Object.keys(accounts.accounts).length === 0) {
        this.showStatus('Please add a Gmail account first', 'error');
        return;
      }

      this.setLoading(true);
      this.showStatus('Searching Gmail for OTP...', 'loading');

      const tab = await this.getActiveTab();
      if (!tab.id) throw new Error('Unable to access active tab');

      const tabUrl = tab.url || tab.pendingUrl;
      if (!tabUrl) throw new Error('Unable to get current tab URL - activeTab permission may not be granted');

      const websiteDomain = new URL(tabUrl).hostname;
      const override = await this.getOverride(websiteDomain);
      const searchDomain = override || websiteDomain;
      const requestId = this.generateRequestId();
      let frameIds: number[] = [];

      if (this.autoFillCheckbox.checked) {
        frameIds = await this.injectBridge(tab.id);
      }

      // The background resolves this only after the whole fetch + fill cycle
      // completes. If an interactive re-auth closes the popup first, this await
      // never resolves here — the onChanged listener / restore path takes over
      // on the next open. So this branch only runs when the popup stayed open.
      const response = await extensionApi.runtime.sendMessage({
        action: 'fetchOTP',
        domain: searchDomain,
        websiteDomain,
        autoFill: this.autoFillCheckbox.checked,
        tabId: tab.id,
        frameIds,
        requestId
      }) as FetchOtpStartResponse;

      if (!response.success) {
        this.showStatus(response.error || 'Unable to start OTP request', 'error');
        this.setLoading(false);
        return;
      }

      if (response.result) await this.renderResult(response.result);
    } catch (error) {
      console.error('Error handling OTP request:', error);
      this.showStatus(`Error: ${(error as Error).message}`, 'error');
      this.setLoading(false);
    }
  }

  private async getActiveTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');
    return tab;
  }

  private async injectBridge(tabId: number): Promise<number[]> {
    try {
      const results = await extensionApi.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['otp-bridge.js']
      });

      return Array.from(new Set(
        results
          .map(result => result.frameId)
          .filter((frameId): frameId is number => typeof frameId === 'number')
      ));
    } catch (error) {
      console.log('[Popup] All-frame OTP bridge injection failed:', (error as Error).message);
    }

    try {
      const results = await extensionApi.scripting.executeScript({
        target: { tabId },
        files: ['otp-bridge.js']
      });

      return Array.from(new Set(
        results
          .map(result => result.frameId)
          .filter((frameId): frameId is number => typeof frameId === 'number')
      ));
    } catch (error) {
      console.log('[Popup] OTP bridge injection skipped:', (error as Error).message);
    }

    return [];
  }

  // On open, recover a result produced while the popup was closed, or reflect a
  // request still in flight (e.g. mid re-auth) so the user waits rather than
  // re-clicking and starting over.
  private async restoreRequestState(): Promise<void> {
    try {
      const stored = await extensionApi.storage.local.get([LATEST_RESULT_KEY, IN_FLIGHT_KEY]) as {
        [LATEST_RESULT_KEY]?: LatestOtpResult;
        [IN_FLIGHT_KEY]?: InFlightRequest;
      };

      const latestResult = stored[LATEST_RESULT_KEY];
      if (latestResult && Date.now() - latestResult.timestamp <= RESULT_TTL_MS) {
        await this.renderResult(latestResult);
        return;
      }

      const inFlight = stored[IN_FLIGHT_KEY];
      if (inFlight && Date.now() - inFlight.startedAt <= RESULT_TTL_MS) {
        this.setLoading(true);
        this.showStatus('Finishing sign-in and grabbing your code…', 'loading');

        // Safety net: if the result never lands (e.g. the worker was lost mid
        // auth), re-enable the button at the TTL so the user can retry.
        const remaining = RESULT_TTL_MS - (Date.now() - inFlight.startedAt);
        this.inFlightSafetyTimer = window.setTimeout(() => {
          this.setLoading(false);
          this.showStatus('That took longer than expected. Try grabbing the code again.', 'error');
        }, remaining);
      }
    } catch (error) {
      console.log('Could not restore OTP request state:', error);
    }
  }

  private async renderResult(result: LatestOtpResult): Promise<void> {
    // Guard against the same result arriving via both the awaited response and
    // the onChanged listener (or a restore), which would double-copy.
    if (result.requestId && result.requestId === this.handledRequestId) return;
    this.handledRequestId = result.requestId ?? null;

    if (Date.now() - result.timestamp > RESULT_TTL_MS) return;

    if (this.inFlightSafetyTimer !== null) {
      window.clearTimeout(this.inFlightSafetyTimer);
      this.inFlightSafetyTimer = null;
    }

    this.setLoading(false);

    if (result.success && result.otp) {
      const copied = await this.copyToClipboard(result.otp);
      const suffix = copied ? ' & copied' : '';
      const message = result.autoFillResult?.success
        ? `OTP auto-filled${suffix}: ${result.otp}`
        : copied
          ? `OTP copied to clipboard: ${result.otp}`
          : `OTP: ${result.otp}`;

      this.showStatus(message, 'success');
    } else {
      this.showStatus(result.message || 'No OTP found in recent emails', 'error');
    }

    await extensionApi.storage.local.remove(LATEST_RESULT_KEY);
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);

      try {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        return document.execCommand('copy');
      } finally {
        textarea.remove();
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }

  private showStatus(message: string, type: 'loading' | 'success' | 'error'): void {
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
    this.statusElement.style.display = 'block';
  }

  private setLoading(isLoading: boolean): void {
    this.grabButton.disabled = isLoading;
    this.grabButton.textContent = isLoading ? 'Searching...' : 'Get OTP from Gmail';
  }

  private async getOverride(websiteDomain: string): Promise<string | null> {
    const result = await extensionApi.storage.local.get(['domain_overrides']) as { domain_overrides?: DomainOverrides };
    const overrides = result.domain_overrides || {};
    return overrides[websiteDomain] || null;
  }

  private async saveOverride(websiteDomain: string, emailDomain: string): Promise<void> {
    const result = await extensionApi.storage.local.get(['domain_overrides']) as { domain_overrides?: DomainOverrides };
    const overrides = result.domain_overrides || {};
    overrides[websiteDomain] = emailDomain;
    await extensionApi.storage.local.set({ domain_overrides: overrides });
  }

  private async clearOverride(websiteDomain: string): Promise<void> {
    const result = await extensionApi.storage.local.get(['domain_overrides']) as { domain_overrides?: DomainOverrides };
    const overrides = result.domain_overrides || {};
    delete overrides[websiteDomain];
    await extensionApi.storage.local.set({ domain_overrides: overrides });
  }

  private toggleOverridePanel(): void {
    const isHidden = this.overridePanel.style.display === 'none';
    this.overridePanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) this.overrideInput.focus();
  }

  private async handleOverrideChange(): Promise<void> {
    const value = this.overrideInput.value.trim().toLowerCase();
    if (!this.currentWebsiteDomain) return;

    if (!value) {
      await this.clearOverride(this.currentWebsiteDomain);
      this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
      this.overrideStatus.textContent = '';
      return;
    }

    if (!value.includes('.') || value.includes(' ')) {
      this.overrideStatus.textContent = 'Enter valid domain (e.g., example.com)';
      this.overrideStatus.style.color = '#c62828';
      return;
    }

    await this.saveOverride(this.currentWebsiteDomain, value);
    this.domainElement.textContent = `Searching: ${value}`;
    this.overrideStatus.textContent = `Override for ${this.currentWebsiteDomain}`;
    this.overrideStatus.style.color = '#2e7d32';
  }

  private async handleClearOverride(): Promise<void> {
    if (!this.currentWebsiteDomain) return;

    await this.clearOverride(this.currentWebsiteDomain);
    this.overrideInput.value = '';
    this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
    this.overrideStatus.textContent = '';
  }

  private async checkForUpdates(): Promise<void> {
    try {
      const cached = await extensionApi.storage.local.get(['version_check']) as { version_check?: VersionInfo };
      const versionInfo = cached.version_check;

      if (versionInfo?.updateAvailable) {
        this.updateMessage.textContent = `Version ${versionInfo.latest} is available (you have ${versionInfo.current}).`;
        this.updateBanner.style.display = 'block';
      }
    } catch (error) {
      console.log('Failed to check for updates:', error);
    }
  }

  private generateRequestId(): string {
    return crypto.randomUUID?.() ?? `otp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

// Firefox popup script - no imports, uses global browser from polyfill
declare const browser: any;

const RESULT_TTL_MS = 60 * 1000;
const AUTO_FILLED_RESULT_TTL_MS = 5 * 1000;

interface OTPRequest {
  action: string;
  domain: string;
  autoFill?: boolean;
  tabId?: number;
  timestamp: number;
  source?: 'gmail' | 'sms';
}

interface OtpFillResult {
  success: boolean;
  strategy: 'segmented' | 'single' | 'focused' | 'none';
  reason?: string;
  score?: number;
}

interface LatestOtpResult {
  success: boolean;
  otp?: string;
  domain: string;
  message?: string;
  tabId?: number;
  autoFillResult?: OtpFillResult;
  accountEmail?: string | null;
  timestamp: number;
}

interface AccountInfo {
  email: string;
  accessToken: string;
  accessTokenExpires: number;
  refreshToken?: string;
  addedAt: number;
  lastUsedAt: number;
}

interface AccountsResponse {
  accounts: Record<string, AccountInfo>;
  activeEmail: string | null;
}

class FirefoxPopupController {
  private statusElement: HTMLElement;
  private grabButton: HTMLButtonElement;
  private smsButton: HTMLButtonElement;
  private domainElement: HTMLElement;
  private autoFillCheckbox: HTMLInputElement;
  private smsCheckbox: HTMLInputElement;
  private updateBanner: HTMLElement;
  private updateMessage: HTMLElement;
  private resultPollingInterval: number | null = null;
  private hasClosed: boolean = false;
  private settingsToggle: HTMLButtonElement;
  private overridePanel: HTMLElement;
  private overrideInput: HTMLInputElement;
  private clearOverrideBtn: HTMLButtonElement;
  private overrideStatus: HTMLElement;
  private currentWebsiteDomain: string = '';

  // Account selector elements
  private accountEmail: HTMLElement;
  private accountDropdownToggle: HTMLButtonElement;
  private accountDropdown: HTMLElement;
  private accountList: HTMLElement;
  private addAccountBtn: HTMLButtonElement;
  private isDropdownOpen: boolean = false;

  constructor() {
    this.statusElement = document.getElementById('status')!;
    this.grabButton = document.getElementById('grabOTP') as HTMLButtonElement;
    this.smsButton = document.getElementById('grabSMS') as HTMLButtonElement;
    this.domainElement = document.getElementById('currentDomain')!;
    this.autoFillCheckbox = document.getElementById('autoFillEnabled') as HTMLInputElement;
    this.smsCheckbox = document.getElementById('smsEnabled') as HTMLInputElement;
    this.updateBanner = document.getElementById('updateBanner')!;
    this.updateMessage = document.getElementById('updateMessage')!;
    this.settingsToggle = document.getElementById('settingsToggle') as HTMLButtonElement;
    this.overridePanel = document.getElementById('domainOverridePanel')!;
    this.overrideInput = document.getElementById('overrideDomain') as HTMLInputElement;
    this.clearOverrideBtn = document.getElementById('clearOverride') as HTMLButtonElement;
    this.overrideStatus = document.getElementById('overrideStatus')!;

    // Account selector elements
    this.accountEmail = document.getElementById('accountEmail')!;
    this.accountDropdownToggle = document.getElementById('accountDropdownToggle') as HTMLButtonElement;
    this.accountDropdown = document.getElementById('accountDropdown')!;
    this.accountList = document.getElementById('accountList')!;
    this.addAccountBtn = document.getElementById('addAccountBtn') as HTMLButtonElement;

    this.init();
  }

  private async init() {
    // Load accounts first
    await this.loadAccounts();

    // Check for updates
    await this.checkForUpdates();
    await this.displayCurrentDomain();
    await this.loadAutoFillPreference();
    await this.loadSmsPreference();
    this.grabButton.addEventListener('click', () => this.handleGrabOTP());
    this.smsButton.addEventListener('click', () => this.handleGrabSmsOTP());
    this.autoFillCheckbox.addEventListener('change', () => this.saveAutoFillPreference());
    this.smsCheckbox.addEventListener('change', () => this.saveSmsPreference());

    // Domain override settings
    this.settingsToggle.addEventListener('click', () => this.toggleOverridePanel());
    this.overrideInput.addEventListener('blur', () => this.handleOverrideChange());
    this.overrideInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleOverrideChange();
        this.overrideInput.blur();
      }
    });
    this.clearOverrideBtn.addEventListener('click', () => this.handleClearOverride());

    // Account selector events
    this.accountDropdownToggle.addEventListener('click', () => this.toggleAccountDropdown());
    document.getElementById('accountRow')?.addEventListener('click', (e) => {
      if (e.target !== this.accountDropdownToggle && !this.accountDropdownToggle.contains(e.target as Node)) {
        this.toggleAccountDropdown();
      }
    });
    this.addAccountBtn.addEventListener('click', () => this.handleAddAccount());

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this.isDropdownOpen && !this.accountDropdown.contains(e.target as Node) &&
          !document.getElementById('accountRow')?.contains(e.target as Node)) {
        this.closeAccountDropdown();
      }
    });

    // Check for recent OTP results when popup opens (restore path)
    await this.checkForRecentResults(true);
  }

  // Account management methods
  private async loadAccounts() {
    try {
      const response = await browser.runtime.sendMessage({ action: 'getAccounts' }) as AccountsResponse;
      this.renderAccounts(response.accounts, response.activeEmail);
    } catch (error) {
      console.error('Error loading accounts:', error);
      this.accountEmail.textContent = 'Error loading accounts';
      this.accountEmail.classList.add('no-account');
    }
  }

  private renderAccounts(accounts: Record<string, AccountInfo>, activeEmail: string | null) {
    const emails = Object.keys(accounts);

    // Update main display
    if (activeEmail && accounts[activeEmail]) {
      this.accountEmail.textContent = activeEmail;
      this.accountEmail.classList.remove('no-account');
    } else if (emails.length > 0) {
      // No active but has accounts - shouldn't happen normally
      this.accountEmail.textContent = emails[0];
      this.accountEmail.classList.remove('no-account');
    } else {
      this.accountEmail.textContent = 'No account connected';
      this.accountEmail.classList.add('no-account');
    }

    // Render dropdown list
    this.accountList.innerHTML = '';

    emails.forEach(email => {
      const isActive = email === activeEmail;
      const item = document.createElement('div');
      item.className = `account-item${isActive ? ' active' : ''}`;
      item.innerHTML = `
        ${isActive ? '<span class="account-item-check">✓</span>' : ''}
        <span class="account-item-email">${email}</span>
        <button class="account-remove-btn" title="Remove account" data-email="${email}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

      // Click to switch account
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.account-remove-btn')) {
          this.handleSwitchAccount(email);
        }
      });

      // Remove button
      const removeBtn = item.querySelector('.account-remove-btn');
      removeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleRemoveAccount(email);
      });

      this.accountList.appendChild(item);
    });
  }

  private toggleAccountDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.accountDropdown.style.display = this.isDropdownOpen ? 'block' : 'none';
    this.accountDropdownToggle.classList.toggle('open', this.isDropdownOpen);
  }

  private closeAccountDropdown() {
    this.isDropdownOpen = false;
    this.accountDropdown.style.display = 'none';
    this.accountDropdownToggle.classList.remove('open');
  }

  private async handleAddAccount() {
    this.closeAccountDropdown();
    this.showStatus('Adding Gmail account...', 'loading');

    try {
      const response = await browser.runtime.sendMessage({ action: 'addAccount' });
      if (response.success) {
        this.showStatus(`Added account: ${response.email}`, 'success');
        await this.loadAccounts();
      } else {
        this.showStatus('Failed to add account', 'error');
      }
    } catch (error) {
      console.error('Error adding account:', error);
      this.showStatus('Error adding account', 'error');
    }
  }

  private async handleSwitchAccount(email: string) {
    this.closeAccountDropdown();

    try {
      await browser.runtime.sendMessage({ action: 'setActiveAccount', email });
      await this.loadAccounts();
    } catch (error) {
      console.error('Error switching account:', error);
      this.showStatus('Error switching account', 'error');
    }
  }

  private async handleRemoveAccount(email: string) {
    if (!confirm(`Remove account ${email}?`)) {
      return;
    }

    try {
      await browser.runtime.sendMessage({ action: 'removeAccount', email });
      await this.loadAccounts();
    } catch (error) {
      console.error('Error removing account:', error);
      this.showStatus('Error removing account', 'error');
    }
  }

  private async displayCurrentDomain() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url || tab?.pendingUrl;

      if (tabUrl) {
        this.currentWebsiteDomain = new URL(tabUrl).hostname;

        // Check for override
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
      } else {
        this.domainElement.textContent = 'Click "Get OTP" to detect current site';
        this.settingsToggle.style.display = 'none';
      }
    } catch (error) {
      console.error('Error getting current domain:', error);
      this.domainElement.textContent = 'Unable to detect current site';
      this.settingsToggle.style.display = 'none';
    }
  }

  private async loadAutoFillPreference() {
    try {
      const result = await browser.storage.local.get(['autoFillEnabled']);
      this.autoFillCheckbox.checked = result.autoFillEnabled ?? true; // Default to true
    } catch (error) {
      console.error('Error loading auto-fill preference:', error);
      this.autoFillCheckbox.checked = true; // Default to true on error
    }
  }

  private async saveAutoFillPreference() {
    try {
      await browser.storage.local.set({ autoFillEnabled: this.autoFillCheckbox.checked });
    } catch (error) {
      console.error('Error saving auto-fill preference:', error);
    }
  }

  // SMS grabbing is an opt-in feature (requires the external phone->Gmail relay),
  // so the secondary button stays hidden until the user enables it here.
  private async loadSmsPreference() {
    try {
      const result = await browser.storage.local.get(['smsEnabled']);
      const enabled = result.smsEnabled ?? false; // Default to off (opt-in)
      this.smsCheckbox.checked = enabled;
      this.smsButton.style.display = enabled ? '' : 'none';
    } catch (error) {
      console.error('Error loading SMS preference:', error);
      this.smsCheckbox.checked = false;
      this.smsButton.style.display = 'none';
    }
  }

  private async saveSmsPreference() {
    try {
      await browser.storage.local.set({ smsEnabled: this.smsCheckbox.checked });
      this.smsButton.style.display = this.smsCheckbox.checked ? '' : 'none';
    } catch (error) {
      console.error('Error saving SMS preference:', error);
    }
  }

  private async handleGrabOTP() {
    // Clear any stale result first, so the first poll tick can't read a
    // lingering auto-filled success from a previous grab and close the popup
    // before the new code arrives.
    await browser.storage.local.remove('latest_otp_result');

    // Check if we have any accounts first
    const accountsResponse = await browser.runtime.sendMessage({ action: 'getAccounts' }) as AccountsResponse;
    if (Object.keys(accountsResponse.accounts).length === 0) {
      this.showStatus('Please add a Gmail account first', 'error');
      return;
    }

    this.setLoading(true);
    this.showStatus('Searching Gmail for OTP...', 'loading');

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !tab.id) {
        throw new Error('Unable to get current tab URL or ID');
      }

      const websiteDomain = new URL(tab.url).hostname;

      // Check for domain override
      const override = await this.getOverride(websiteDomain);
      const searchDomain = override || websiteDomain;

      // If auto-fill is enabled, inject bridge immediately via background
      if (this.autoFillCheckbox.checked) {
        try {
          console.log('[Firefox Popup] Auto-fill enabled, requesting bridge injection...');
          const injectionResult = await browser.runtime.sendMessage({
            action: 'injectBridge',
            tabId: tab.id
          });

          if (!injectionResult.success) {
            throw new Error(injectionResult.error || 'Bridge injection failed');
          }

          // Wait a moment for bridge to connect
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log('[Firefox Popup] Bridge injected, now fetching OTP...');
        } catch (error) {
          // Just log the error - OTP will still be copied to clipboard
          console.log('[Firefox Popup] Bridge injection skipped:', (error as Error).message);
        }
      }

      // Send OTP fetch request (fire-and-forget style for Firefox)
      browser.runtime.sendMessage({
        action: 'fetchOTP',
        domain: searchDomain,
        autoFill: this.autoFillCheckbox.checked,
        tabId: tab.id,
        timestamp: Date.now()
      } as OTPRequest);

      // Request sent, keep loading state and start polling for results
      this.startResultPolling();

    } catch (error) {
      console.error('Error sending OTP request:', error);
      this.showStatus('Error: ' + (error as Error).message, 'error');
      this.setLoading(false); // Only stop loading on error
      this.stopResultPolling();
    }
  }

  // Grab a code forwarded from SMS (subject-tagged in Gmail by the phone relay),
  // bypassing domain matching. Otherwise mirrors handleGrabOTP.
  private async handleGrabSmsOTP() {
    await browser.storage.local.remove('latest_otp_result');

    const accountsResponse = await browser.runtime.sendMessage({ action: 'getAccounts' }) as AccountsResponse;
    if (Object.keys(accountsResponse.accounts).length === 0) {
      this.showStatus('Please add a Gmail account first', 'error');
      return;
    }

    this.setLoading(true, 'sms');
    this.showStatus('Looking for a forwarded SMS code...', 'loading');

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('Unable to get current tab ID');
      }

      const websiteDomain = tab.url ? new URL(tab.url).hostname : '';

      if (this.autoFillCheckbox.checked) {
        try {
          const injectionResult = await browser.runtime.sendMessage({
            action: 'injectBridge',
            tabId: tab.id
          });
          if (!injectionResult.success) {
            throw new Error(injectionResult.error || 'Bridge injection failed');
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.log('[Firefox Popup] Bridge injection skipped:', (error as Error).message);
        }
      }

      browser.runtime.sendMessage({
        action: 'fetchOTP',
        source: 'sms',
        domain: websiteDomain,
        autoFill: this.autoFillCheckbox.checked,
        tabId: tab.id,
        timestamp: Date.now()
      } as OTPRequest);

      this.startResultPolling();
    } catch (error) {
      console.error('Error sending SMS OTP request:', error);
      this.showStatus('Error: ' + (error as Error).message, 'error');
      this.setLoading(false);
      this.stopResultPolling();
    }
  }

  // Called both as a fresh-open restore (isRestore=true, from init) and as the
  // active poll while a grab is in flight (isRestore=false, from polling).
  private async checkForRecentResults(isRestore: boolean = false) {
    try {
      const stored = await browser.storage.local.get('latest_otp_result');
      const result = stored['latest_otp_result'] as LatestOtpResult | undefined;
      if (!result) return;

      // Drop anything past the 1-minute window.
      if (Date.now() - result.timestamp >= RESULT_TTL_MS) {
        await browser.storage.local.remove('latest_otp_result');
        return;
      }

      const autoFilled = this.isAutoFilledResult(result);

      if (!isRestore) {
        // Active path: the result just landed while the popup is open & polling.
        this.displayResult(result);
        this.setLoading(false);
        this.stopResultPolling();

        if (autoFilled) {
          if (!this.hasClosed) {
            this.hasClosed = true;
            await this.returnFocusToPageAndClose(result.tabId);
          }
          // Leave the result in storage so the 5s same-tab restore can find it.
          return;
        }

        await browser.storage.local.remove('latest_otp_result');
        return;
      }

      // Restore path: the popup opened fresh and found a recent result.
      this.setLoading(false);
      this.stopResultPolling();

      if (autoFilled) {
        const fresh = Date.now() - result.timestamp <= AUTO_FILLED_RESULT_TTL_MS;
        if (fresh && await this.isSamePageAsResult(result)) {
          // Re-show the auto-filled result, but do NOT close again.
          this.displayResult(result);
        } else {
          await browser.storage.local.remove('latest_otp_result');
        }
        return;
      }

      this.displayResult(result);
      await browser.storage.local.remove('latest_otp_result');
    } catch (error) {
      console.log('Could not check recent results:', error);
    }
  }

  private displayResult(result: LatestOtpResult) {
    if (result.success && result.otp) {
      this.showStatus(`${result.message}`, 'success');
      // Auto-select the OTP text for easy copying
      this.statusElement.setAttribute('data-otp', result.otp);
    } else {
      this.showStatus(`${result.message}`, 'error');
    }
  }

  private isAutoFilledResult(result: LatestOtpResult): boolean {
    return result.success && Boolean(result.otp) && result.autoFillResult?.success === true;
  }

  // tabId-only same-page guard: "same page" means "same tab".
  private async isSamePageAsResult(result: LatestOtpResult): Promise<boolean> {
    if (result.tabId === undefined) return true;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id === result.tabId;
    } catch {
      return false;
    }
  }

  private async returnFocusToPageAndClose(tabId?: number) {
    try {
      if (tabId !== undefined) await browser.tabs.update(tabId, { active: true });
    } catch (error) {
      console.log('Could not refocus page after auto-fill:', error);
    } finally {
      window.close();
    }
  }

  private async clearBadge() {
    try {
      await browser.browserAction.setBadgeText({ text: '' });
      await browser.browserAction.setTitle({ title: 'Grab OTP from Gmail' });
    } catch (error) {
      console.log('Could not clear badge:', error);
    }
  }

  private startResultPolling() {
    // Poll every 500ms for results while loading
    this.resultPollingInterval = window.setInterval(async () => {
      await this.checkForRecentResults(false);
    }, 500);

    // Stop polling after 30 seconds to avoid infinite polling
    setTimeout(() => {
      this.stopResultPolling();
    }, 30000);
  }

  private stopResultPolling() {
    if (this.resultPollingInterval) {
      clearInterval(this.resultPollingInterval);
      this.resultPollingInterval = null;
    }
  }



  private showStatus(message: string, type: 'loading' | 'success' | 'error') {
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
    this.statusElement.style.display = 'block';
  }

  private setLoading(isLoading: boolean, active: 'gmail' | 'sms' = 'gmail') {
    this.grabButton.disabled = isLoading;
    this.smsButton.disabled = isLoading;
    this.grabButton.textContent = isLoading && active === 'gmail' ? 'Searching...' : 'Get OTP from Gmail';
    this.smsButton.textContent = isLoading && active === 'sms' ? 'Searching...' : 'Grab SMS code';
  }

  // Domain override methods
  private async getOverride(websiteDomain: string): Promise<string | null> {
    try {
      const result = await browser.storage.local.get(['domain_overrides']);
      const overrides = result.domain_overrides || {};
      return overrides[websiteDomain] || null;
    } catch (error) {
      console.error('Error getting domain override:', error);
      return null;
    }
  }

  private async saveOverride(websiteDomain: string, emailDomain: string): Promise<void> {
    try {
      const result = await browser.storage.local.get(['domain_overrides']);
      const overrides = result.domain_overrides || {};
      overrides[websiteDomain] = emailDomain;
      await browser.storage.local.set({ domain_overrides: overrides });
    } catch (error) {
      console.error('Error saving domain override:', error);
    }
  }

  private async clearOverride(websiteDomain: string): Promise<void> {
    try {
      const result = await browser.storage.local.get(['domain_overrides']);
      const overrides = result.domain_overrides || {};
      delete overrides[websiteDomain];
      await browser.storage.local.set({ domain_overrides: overrides });
    } catch (error) {
      console.error('Error clearing domain override:', error);
    }
  }

  private toggleOverridePanel() {
    const isHidden = this.overridePanel.style.display === 'none';
    this.overridePanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.overrideInput.focus();
    }
  }

  private async handleOverrideChange() {
    const value = this.overrideInput.value.trim().toLowerCase();

    if (!this.currentWebsiteDomain) return;

    if (!value) {
      // Empty input - clear override
      await this.clearOverride(this.currentWebsiteDomain);
      this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
      this.overrideStatus.textContent = '';
      return;
    }

    // Basic validation - should have at least one dot and no spaces
    if (!value.includes('.') || value.includes(' ')) {
      this.overrideStatus.textContent = 'Enter a valid domain (e.g., example.com)';
      this.overrideStatus.style.color = '#c62828';
      return;
    }

    // Don't save if same as detected domain
    if (value === this.currentWebsiteDomain) {
      await this.clearOverride(this.currentWebsiteDomain);
      this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
      this.overrideStatus.textContent = '';
      return;
    }

    await this.saveOverride(this.currentWebsiteDomain, value);
    this.domainElement.textContent = `Searching: ${value}`;
    this.overrideStatus.textContent = `Override for ${this.currentWebsiteDomain}`;
    this.overrideStatus.style.color = '#2e7d32';
  }

  private async handleClearOverride() {
    if (!this.currentWebsiteDomain) return;

    await this.clearOverride(this.currentWebsiteDomain);
    this.overrideInput.value = '';
    this.domainElement.textContent = `Current site: ${this.currentWebsiteDomain}`;
    this.overrideStatus.textContent = '';
  }

  private async checkForUpdates() {
    try {
      const result = await browser.storage.local.get(['version_check']);
      const versionInfo = result.version_check;

      if (versionInfo && versionInfo.updateAvailable) {
        this.updateMessage.textContent = `Version ${versionInfo.latest} is available (you have ${versionInfo.current}).`;
        this.updateBanner.style.display = 'block';
      }
    } catch (error) {
      // Silent fail - don't disrupt user experience for version checks
      console.log('Failed to check for updates:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new FirefoxPopupController();
});

export {};

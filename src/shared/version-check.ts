/**
 * Version Check Utility
 * Checks GitHub for newer versions and notifies users
 */

interface VersionInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  lastChecked: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
}

/**
 * Compare two semantic version strings
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(n => parseInt(n, 10));
  const parts2 = v2.split('.').map(n => parseInt(n, 10));

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }

  return 0;
}

/**
 * Check for updates from GitHub
 * Caches results for 24 hours to avoid API spam
 */
export async function checkForUpdates(
  currentVersion: string,
  storage: any // chrome.storage or browser.storage
): Promise<VersionInfo | null> {
  try {
    // Check cache first (24 hour TTL)
    const cached = await storage.local.get(['version_check']);
    if (cached.version_check &&
        Date.now() - cached.version_check.lastChecked < 24 * 60 * 60 * 1000) {
      return cached.version_check;
    }

    // Fetch latest release from GitHub
    const response = await fetch(
      'https://api.github.com/repos/jeff-schumann/grab-otp/releases/latest',
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      console.log('Version check: GitHub API returned', response.status);
      return null;
    }

    const release: GitHubRelease = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix

    const versionInfo: VersionInfo = {
      current: currentVersion,
      latest: latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
      lastChecked: Date.now()
    };

    // Cache the result
    await storage.local.set({ version_check: versionInfo });

    console.log('Version check:', versionInfo);
    return versionInfo;

  } catch (error) {
    console.log('Version check failed (non-critical):', error);
    return null;
  }
}

/**
 * Get cached version info without checking GitHub
 */
export async function getCachedVersionInfo(storage: any): Promise<VersionInfo | null> {
  try {
    const cached = await storage.local.get(['version_check']);
    return cached.version_check || null;
  } catch {
    return null;
  }
}

/**
 * Mark that user has seen the update notification
 */
export async function markUpdateNotificationSeen(storage: any): Promise<void> {
  try {
    await storage.local.set({ update_notification_seen: Date.now() });
  } catch (error) {
    console.error('Failed to mark update notification as seen:', error);
  }
}

/**
 * Check if user has already seen the update notification for current latest version
 */
export async function hasSeenUpdateNotification(storage: any): Promise<boolean> {
  try {
    const result = await storage.local.get(['update_notification_seen', 'version_check']);
    if (!result.update_notification_seen || !result.version_check) {
      return false;
    }

    // User has seen notification if they've seen it within the last 7 days
    const seenRecently = Date.now() - result.update_notification_seen < 7 * 24 * 60 * 60 * 1000;
    return seenRecently;
  } catch {
    return false;
  }
}

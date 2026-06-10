// Unified OAuth module for multi-account Gmail support
// Uses PKCE OAuth flow for both Chrome and Firefox

import { generateCodeVerifier, generateCodeChallenge, exchangeCodeForTokens, refreshAccessToken } from './pkce';

// Re-export PKCE utilities for convenience
export { generateCodeVerifier, generateCodeChallenge, exchangeCodeForTokens, refreshAccessToken };

export const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// Keep the request all-or-nothing. The account email is read from Gmail's
// profile endpoint after this scope is granted.
export const GMAIL_SCOPE = REQUIRED_SCOPE;

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface TokenData {
  accessToken: string;
  accessTokenExpires: number;
  refreshToken?: string;
  grantedScopes?: string;
}

export interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Retrieve the granted scopes for an access token via Google's tokeninfo endpoint.
 * Unauthenticated endpoint — safe to call without additional permissions.
 */
export async function getTokenScopes(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.scope || null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the account email for an access token via Google's tokeninfo endpoint.
 * Fallback for when the userinfo endpoint fails right after an auth flow.
 */
export async function getTokenEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.email || null;
  } catch {
    return null;
  }
}

/**
 * Perform PKCE OAuth authentication flow
 * Returns tokens on success, null on failure
 */
export async function performPKCEAuth(
  config: OAuthConfig,
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string>
): Promise<TokenData | null> {
  try {
    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      // `consent` is required to reliably receive/refresh offline tokens in Firefox.
      prompt: 'consent select_account',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params}`;
    console.log('[OAuth] Launching PKCE auth flow...');
    console.log('[OAuth] Client ID:', config.clientId ? config.clientId.substring(0, 20) + '...' : 'MISSING');
    console.log('[OAuth] Redirect URI:', config.redirectUri);
    console.log('[OAuth] Full auth URL:', authUrl);

    const responseUrl = await launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });

    if (!responseUrl) {
      console.log('[OAuth] No response URL from auth flow');
      return null;
    }

    // Parse authorization code from URL query params
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');

    if (!code) {
      console.log('[OAuth] No authorization code in response');
      return null;
    }

    console.log('[OAuth] Authorization code received, exchanging for tokens...');

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      code,
      codeVerifier,
      config.clientId,
      config.redirectUri,
      config.clientSecret
    );

    if (!tokens) {
      console.log('[OAuth] Token exchange failed');
      return null;
    }

    console.log('[OAuth] Token exchange successful, refresh_token:', tokens.refresh_token ? 'received' : 'not received');

    return {
      accessToken: tokens.access_token,
      accessTokenExpires: Date.now() + ((tokens.expires_in - 300) * 1000), // 5 min buffer
      refreshToken: tokens.refresh_token,
      grantedScopes: tokens.scope
    };
  } catch (error) {
    console.error('[OAuth] PKCE auth error:', error);
    return null;
  }
}

/**
 * Attempt silent authentication using existing Google session
 * Returns token data on success, null if interactive auth needed
 */
export async function attemptSilentAuth(
  config: OAuthConfig,
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string>
): Promise<TokenData | null> {
  try {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'token',
      redirect_uri: config.redirectUri,
      scope: GMAIL_SCOPE,
      prompt: 'none'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params}`;

    const responseUrl = await launchWebAuthFlow({
      url: authUrl,
      interactive: false
    });

    if (!responseUrl) {
      return null;
    }

    const urlFragment = responseUrl.split('#')[1];
    if (!urlFragment) {
      return null;
    }

    const urlParams = new URLSearchParams(urlFragment);
    const token = urlParams.get('access_token');
    const expiresIn = urlParams.get('expires_in');

    if (!token) {
      return null;
    }

    // Implicit flow doesn't include scope in the fragment — fetch it separately
    const scopes = await getTokenScopes(token);

    return {
      accessToken: token,
      accessTokenExpires: Date.now() + ((parseInt(expiresIn || '3600') - 300) * 1000),
      // No refresh token from implicit flow
      grantedScopes: scopes ?? undefined
    };
  } catch (error) {
    // Silent auth failure is expected if no valid session
    console.log('[OAuth] Silent auth not available:', (error as Error).message);
    return null;
  }
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshToken(
  refreshTokenValue: string,
  clientId: string,
  clientSecret?: string
): Promise<TokenData | null> {
  try {
    const tokens = await refreshAccessToken(refreshTokenValue, clientId, clientSecret);

    if (!tokens) {
      return null;
    }

    return {
      accessToken: tokens.access_token,
      accessTokenExpires: Date.now() + ((tokens.expires_in - 300) * 1000),
      // Refresh token doesn't change on refresh
      grantedScopes: tokens.scope
    };
  } catch (error) {
    console.error('[OAuth] Token refresh error:', error);
    return null;
  }
}

/**
 * Fetch user's email address from Google userinfo API
 */
export async function getUserEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error('[OAuth] Failed to fetch user info:', response.status);
      return null;
    }

    const data = await response.json();
    return data.email || null;
  } catch (error) {
    console.error('[OAuth] Error fetching user email:', error);
    return null;
  }
}

/**
 * Fetch the Gmail account email using the same Gmail scope the app already
 * needs to read OTP messages.
 */
export async function getGmailProfileEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error('[OAuth] Failed to fetch Gmail profile:', response.status);
      return null;
    }

    const data = await response.json();
    return data.emailAddress || null;
  } catch (error) {
    console.error('[OAuth] Error fetching Gmail profile:', error);
    return null;
  }
}

/**
 * Fetch full user info from Google userinfo API
 */
export async function getUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error('[OAuth] Failed to fetch user info:', response.status);
      return null;
    }

    const data = await response.json();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture
    };
  } catch (error) {
    console.error('[OAuth] Error fetching user info:', error);
    return null;
  }
}

/**
 * Validate that a token is still valid by testing against Gmail API
 */
export async function validateToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/gmail/v1/users/me/profile',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

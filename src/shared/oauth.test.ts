import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGmailProfileEmail, GMAIL_SCOPE, REQUIRED_SCOPE } from './oauth';

describe('OAuth scopes', () => {
  it('requests only Gmail readonly so consent is all-or-nothing', () => {
    expect(GMAIL_SCOPE).toBe(REQUIRED_SCOPE);
    expect(GMAIL_SCOPE).not.toContain('userinfo.email');
  });
});

describe('getGmailProfileEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the account email from the Gmail profile endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ emailAddress: 'jane@example.com' })
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getGmailProfileEmail('access-token')).resolves.toBe('jane@example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/gmail/v1/users/me/profile',
      {
        headers: {
          Authorization: 'Bearer access-token'
        }
      }
    );
  });

  it('returns null when Gmail profile lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 } as Response)));

    await expect(getGmailProfileEmail('limited-token')).resolves.toBeNull();
  });
});

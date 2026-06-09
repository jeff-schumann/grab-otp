import { describe, expect, it } from 'vitest';
import { buildSenderQuery, getRegistrableDomain } from './gmail-query';

describe('getRegistrableDomain', () => {
  it('strips a subdomain down to brand + suffix', () => {
    expect(getRegistrableDomain('vault.bitwarden.com')).toBe('bitwarden.com');
    expect(getRegistrableDomain('email.example.com')).toBe('example.com');
  });

  it('leaves an already-bare domain unchanged', () => {
    expect(getRegistrableDomain('bitwarden.com')).toBe('bitwarden.com');
  });

  it('drops a leading www', () => {
    expect(getRegistrableDomain('www.example.com')).toBe('example.com');
  });

  it('keeps three labels for compound public suffixes', () => {
    expect(getRegistrableDomain('login.example.co.uk')).toBe('example.co.uk');
    expect(getRegistrableDomain('app.shop.com.au')).toBe('shop.com.au');
  });

  it('is case-insensitive', () => {
    expect(getRegistrableDomain('Vault.BitWarden.com')).toBe('bitwarden.com');
  });
});

describe('buildSenderQuery', () => {
  it('matches the base domain and brand for a subdomain host', () => {
    // The motivating case: site is vault.bitwarden.com, mail is from bitwarden.com.
    expect(buildSenderQuery('vault.bitwarden.com')).toBe(
      '(from:bitwarden.com OR from:vault.bitwarden.com OR from:bitwarden)'
    );
  });

  it('omits the redundant exact term when host equals the base domain', () => {
    expect(buildSenderQuery('bitwarden.com')).toBe('(from:bitwarden.com OR from:bitwarden)');
  });

  it('drops the bare-brand term when the brand is too short to be useful', () => {
    expect(buildSenderQuery('id.example')).not.toContain('OR from:id');
  });

  it('handles compound suffixes without searching the suffix as a brand', () => {
    expect(buildSenderQuery('login.example.co.uk')).toBe(
      '(from:example.co.uk OR from:login.example.co.uk OR from:example)'
    );
  });

  it('falls back to a literal match for IP addresses and bare hosts', () => {
    expect(buildSenderQuery('192.168.1.1')).toBe('(from:192.168.1.1 OR from:@192.168.1.1)');
    expect(buildSenderQuery('localhost')).toBe('(from:localhost OR from:@localhost)');
  });
});

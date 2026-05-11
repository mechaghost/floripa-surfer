import { describe, expect, it } from 'vitest';
import { isLocalhost } from '../src/localAccess';

describe('local-only access helpers', () => {
  it('allows pose tooling on loopback hosts', () => {
    expect(isLocalhost('localhost')).toBe(true);
    expect(isLocalhost('127.0.0.1')).toBe(true);
    expect(isLocalhost('127.12.0.4')).toBe(true);
    expect(isLocalhost('::1')).toBe(true);
    expect(isLocalhost('[::1]')).toBe(true);
  });

  it('blocks pose tooling on deployed and network hosts', () => {
    expect(isLocalhost('floripa-surfer.example.com')).toBe(false);
    expect(isLocalhost('example.com')).toBe(false);
    expect(isLocalhost('192.168.1.12')).toBe(false);
    expect(isLocalhost('')).toBe(false);
  });
});

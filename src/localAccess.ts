const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;

export function isLocalhost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');

  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    LOOPBACK_IPV4_PATTERN.test(normalized)
  );
}

export function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split('.')
    .map(Number)
}

export function compareVersions(v1: string, v2: string): number {
  const n1 = parseVersion(v1)
  const n2 = parseVersion(v2)

  for (let i = 0; i < Math.max(n1.length, n2.length); i++) {
    const a = n1[i] || 0
    const b = n2[i] || 0
    if (a > b) return 1
    if (a < b) return -1
  }

  return 0
}

export function isNewerVersion(current: string, remote: string): boolean {
  return compareVersions(remote, current) > 0
}

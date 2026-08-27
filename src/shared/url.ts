export function urlMatchesPattern(url: string, pattern: string): boolean {
  const parsed = new URL(url, "http://runtime.local");
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(parsed.pathname);
}

export function deriveUrlPattern(url: string): string {
  const parsed = new URL(url, "http://runtime.local");
  return parsed.pathname
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment) ? "*" : segment,
    )
    .join("/");
}

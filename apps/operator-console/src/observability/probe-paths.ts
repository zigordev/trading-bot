const UNSAMPLED_PATHS = [/^\/health$/, /^\/metrics$/, /^\/rum(\/|$)/, /^\/_next\/static(\/|$)/];

const PATH_ATTRIBUTES = ['url.path', 'http.route', 'http.target'] as const;

export function isUnsampledPath(path: string | undefined): boolean {
  if (!path) return false;
  const [withoutQuery = path] = path.split('?');
  return UNSAMPLED_PATHS.some((pattern) => pattern.test(withoutQuery));
}

export function pathOfSpan(attributes: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of PATH_ATTRIBUTES) {
    const candidate = attributes[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  const full = attributes['url.full'] ?? attributes['http.url'];
  if (typeof full !== 'string') return undefined;
  try {
    return new URL(full).pathname;
  } catch {
    return undefined;
  }
}

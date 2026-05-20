export function projectBasePath(projectId: string): string {
  return `/p/${projectId}`;
}

export function projectPath(projectId: string, suffix = ''): string {
  const base = projectBasePath(projectId);
  if (!suffix) return base;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function projectBaseFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'p') {
    return `/p/${segments[1]}`;
  }
  return '/';
}

export function projectUuidFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'p') return segments[1];
  return null;
}

export function projectPathSuffix(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 2 || segments[0] !== 'p') return '';
  return `/${segments.slice(2).join('/')}`;
}

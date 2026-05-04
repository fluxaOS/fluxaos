'use client';

import { useEffect, useState } from 'react';
import { links } from '@/lib/links';

// Returns GitHub stargazer count for fluxaOS/fluxaos. Best-effort:
// silently no-ops on rate-limit or network errors.
export function useGitHubStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('https://api.github.com/repos/fluxaOS/fluxaos', {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.stargazers_count === 'number') {
          setStars(d.stargazers_count);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return stars;
}

export function GitHubStarBadge() {
  const stars = useGitHubStars();
  return (
    <a
      href={links.github}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[11px] text-[var(--muted)] hover:text-white transition-colors"
    >
      ★ {stars === null ? '—' : stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars}
    </a>
  );
}

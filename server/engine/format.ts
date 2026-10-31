import { ChipKind, ExtraKind } from './types';

export function formatBalls(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ballChip(b: {
  extra: ExtraKind | null;
  runs: number;
  noballExtra?: 'bye' | 'legbye';
  wicket: boolean;
  boundary: boolean;
  batRuns: number;
}): { label: string; kind: ChipKind } {
  const { extra, runs, wicket } = b;
  const n = runs > 0 ? String(runs) : '';
  if (extra === 'dead') return { label: wicket ? 'W' : 'Db', kind: wicket ? 'wicket' : 'dead' };
  if (extra === 'wide') return { label: wicket ? `${n}Wd+W` : `${n}Wd`, kind: wicket ? 'wicket' : 'wide' };
  if (extra === 'noball') {
    if (b.noballExtra) {
      const suffix = b.noballExtra === 'bye' ? 'B' : 'Lb';
      return { label: wicket ? `Nb+${runs}${suffix}+W` : `Nb+${runs}${suffix}`, kind: wicket ? 'wicket' : 'noball' };
    }
    return { label: wicket ? `${n}Nb+W` : `${n}Nb`, kind: wicket ? 'wicket' : 'noball' };
  }
  if (extra === 'bye') return { label: wicket ? `${runs}B+W` : `${runs}B`, kind: wicket ? 'wicket' : 'bye' };
  if (extra === 'legbye') return { label: wicket ? `${runs}Lb+W` : `${runs}Lb`, kind: wicket ? 'wicket' : 'legbye' };
  if (wicket) return { label: runs > 0 ? `${runs}W` : 'W', kind: 'wicket' };
  if (b.boundary && runs === 4) return { label: '4', kind: 'four' };
  if (b.boundary && runs === 6) return { label: '6', kind: 'six' };
  return { label: String(runs), kind: runs === 0 ? 'dot' : 'run' };
}

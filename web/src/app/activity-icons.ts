/**
 * Maps a report's activity string to a display icon (emoji), a readable
 * label, and a color. Activities differ per source (PowderGuide, Camptocamp,
 * skitour.fr), so we normalize loosely by matching keywords. Falls back to a
 * generic mountain.
 *
 * Figma activity colors:
 *   Winter #0072bb · Sommer #3b8c47 · Summer2/misc #168b70 ·
 *   Bergsteigen2 #43526a · Klettern #404040
 */
interface ActivityDisplay {
  icon: string;
  label: string;
  color: string;
}

const RULES: Array<{ match: RegExp; icon: string; label: string; color: string }> = [
  { match: /ski.?tour|skitour/i, icon: '🎿', label: 'Skitour', color: '#0072bb' },
  { match: /freeride/i, icon: '🏂', label: 'Freeride', color: '#0072bb' },
  { match: /snowshoe|schneeschuh|raquette/i, icon: '🥾', label: 'Schneeschuh', color: '#0072bb' },
  { match: /ice.?climb|cascade|glace/i, icon: '🧊', label: 'Eisklettern', color: '#0072bb' },
  { match: /rock.?climb|escalade|klettern/i, icon: '🧗', label: 'Klettern', color: '#404040' },
  { match: /via.?ferrata|klettersteig/i, icon: '⛓️', label: 'Klettersteig', color: '#43526a' },
  { match: /mountain.?bike|vtt|bike|velo/i, icon: '🚵', label: 'Bike', color: '#3b8c47' },
  { match: /paraglid|parapente|gleitschirm/i, icon: '🪂', label: 'Gleitschirm', color: '#168b70' },
  { match: /mountain.?climb|alpin|mountaineer|hochtour/i, icon: '⛰️', label: 'Hochtour', color: '#43526a' },
  { match: /hik|rando|wander/i, icon: '🥾', label: 'Wanderung', color: '#3b8c47' },
  { match: /slackline/i, icon: '🎪', label: 'Slackline', color: '#168b70' },
];

const FALLBACK: ActivityDisplay = { icon: '⛰️', label: 'Tour', color: '#168b70' };

export function activityDisplay(activity: string | null): ActivityDisplay {
  if (!activity) return FALLBACK;
  for (const rule of RULES) {
    if (rule.match.test(activity)) {
      return { icon: rule.icon, label: rule.label, color: rule.color };
    }
  }
  return FALLBACK;
}

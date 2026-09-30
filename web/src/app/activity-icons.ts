/**
 * Maps a report's activity string to a display icon (emoji) and a readable
 * label. Activities differ per source (PowderGuide, Camptocamp, skitour.fr), so
 * we normalize loosely by matching keywords. Falls back to a generic mountain.
 */
interface ActivityDisplay {
  icon: string;
  label: string;
}

const RULES: Array<{ match: RegExp; icon: string; label: string }> = [
  { match: /ski.?tour|skitour/i, icon: '🎿', label: 'Skitour' },
  { match: /freeride/i, icon: '🏂', label: 'Freeride' },
  { match: /snowshoe|schneeschuh|raquette/i, icon: '🥾', label: 'Schneeschuh' },
  { match: /ice.?climb|cascade|glace/i, icon: '🧊', label: 'Eisklettern' },
  { match: /rock.?climb|escalade|klettern/i, icon: '🧗', label: 'Klettern' },
  { match: /via.?ferrata|klettersteig/i, icon: '⛓️', label: 'Klettersteig' },
  { match: /mountain.?bike|vtt|bike|velo/i, icon: '🚵', label: 'Bike' },
  { match: /paraglid|parapente|gleitschirm/i, icon: '🪂', label: 'Gleitschirm' },
  { match: /mountain.?climb|alpin|mountaineer|hochtour/i, icon: '⛰️', label: 'Hochtour' },
  { match: /hik|rando|wander/i, icon: '🥾', label: 'Wanderung' },
  { match: /slackline/i, icon: '🎪', label: 'Slackline' },
];

const FALLBACK: ActivityDisplay = { icon: '⛰️', label: 'Tour' };

export function activityDisplay(activity: string | null): ActivityDisplay {
  if (!activity) return FALLBACK;
  for (const rule of RULES) {
    if (rule.match.test(activity)) {
      return { icon: rule.icon, label: rule.label };
    }
  }
  return FALLBACK;
}

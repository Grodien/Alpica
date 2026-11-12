/**
 * Filter options for the mobile filter bottom-sheet.
 *
 * Each category `key` is the canonical category stored on the report (set at
 * crawl time by crawler/src/categories.js). The sheet sends the selected keys
 * directly as the `categories` query param; the API filters with
 * `category IN (...)`. Keep these keys in sync with CATEGORY_PRIORITY.
 *
 * Colors match the activity palette (see activity-icons.ts / styles.css).
 */
export interface FilterCategory {
  /** Canonical category key (matches the DB `category` column). */
  key: string;
  /** Translation key for the label shown on the chip (see i18n/*.ts). */
  labelKey: string;
  /** Icon asset (under assets/categories). */
  icon: string;
  /** Active-chip background color. */
  color: string;
}

export const FILTER_CATEGORIES: FilterCategory[] = [
  { key: 'skitour',      labelKey: 'category.skitour',      icon: 'assets/categories/ski.svg',          color: '#0072bb' },
  { key: 'schneeschuh',  labelKey: 'category.schneeschuh',  icon: 'assets/categories/schneeschuh.svg',  color: '#0072bb' },
  { key: 'eisklettern',  labelKey: 'category.eisklettern',  icon: 'assets/categories/eis.svg',          color: '#0072bb' },
  { key: 'freeride',     labelKey: 'category.freeride',     icon: 'assets/categories/freeride.svg',     color: '#0072bb' },
  { key: 'klettertour',  labelKey: 'category.klettertour',  icon: 'assets/categories/klettertour.svg',  color: '#404040' },
  { key: 'klettersteig', labelKey: 'category.klettersteig', icon: 'assets/categories/klettersteig.svg', color: '#43526a' },
  { key: 'wanderung',    labelKey: 'category.wanderung',    icon: 'assets/categories/alpwanderung.svg', color: '#3b8c47' },
  { key: 'hochtour',     labelKey: 'category.hochtour',     icon: 'assets/categories/hochtour.svg',     color: '#43526a' },
  { key: 'bike',         labelKey: 'category.bike',         icon: 'assets/categories/bike.svg',         color: '#3b8c47' },
  { key: 'canyoning',    labelKey: 'category.canyoning',    icon: 'assets/categories/canyoning.svg',    color: '#168b70' },
  { key: 'andere',       labelKey: 'category.andere',       icon: 'assets/categories/anderes.svg',      color: '#168b70' },
];

export interface FilterSource {
  /** DB `source` value. */
  key: string;
  /** Label shown on the chip (brand/domain names — not translated). */
  label: string;
}

export const FILTER_SOURCES: FilterSource[] = [
  { key: 'camptocamp',  label: 'camptocamp' },
  { key: 'gipfelbuch',  label: 'Gipfelbuch' },
  { key: 'powderguide', label: 'POWDERGUIDE' },
  { key: 'skitour',     label: 'Skitour' },
];

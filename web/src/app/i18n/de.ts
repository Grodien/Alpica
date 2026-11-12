import type { Dict } from './types';

/**
 * German UI strings — the project's original language. Keys are grouped by
 * screen/area. Interpolation uses {name} placeholders resolved by I18nService.t().
 */
export const de: Dict = {
  // --- Generic / shared ---
  'app.logoAlt': 'MountainRADAR',
  'app.claimAlt': 'One Search. All Conditions.',
  'lang.switch': 'Sprache',
  'lang.de': 'Deutsch',
  'lang.en': 'Englisch',

  // --- Home: search ---
  'home.searchPlaceholder': 'Wo geht es hin?',
  'home.searchAria': 'Suchort',
  'home.searchButtonAria': 'Suchen',
  'home.clearSearchAria': 'Suche zurücksetzen',
  'home.filterAria': 'Filter',
  'home.loading': 'Lade…',

  // --- Home: date range slider ---
  'home.rangeAria': 'Datumsbereich',
  'range.3days': '3 Tage',
  'range.1week': '1 Woche',
  'range.1month': '1 Monat',
  'range.6months': '6 Monate',
  'range.all': 'Alle',

  // --- Home: filter dropdowns (desktop) ---
  'home.allCategories': 'Alle Kategorien',
  'home.allSources': 'Alle Quellen',

  // --- Home: map ---
  'home.mapAria': 'Karte mit Ergebnissen',
  'home.locateAria': 'Meinen Standort anzeigen',

  // --- Home: results ---
  'home.resultsCount': '{count} Ergebnisse',

  // --- Home: footer ---
  'footer.claim': 'One Search. All Conditions.',
  // Attribution is composed in the template from these parts + a real <a> so
  // the link picks up the component's scoped styles (incl. :visited).
  'footer.attributionPre': 'Eine Dienstleistung der',
  'footer.attributionMid': ', den Machern von',
  'footer.legalNav': 'Rechtliches',
  'footer.impressum': 'Impressum',
  'footer.privacy': 'Datenschutz',
  'footer.legal': 'Rechtliche Aspekte',

  // --- Dropdown ---
  'dropdown.selectedCount': '{count} ausgewählt',
  'dropdown.clearAria': 'Auswahl zurücksetzen',

  // --- Filter sheet (mobile) ---
  'filter.title': 'Filter',
  'filter.closeAria': 'Schließen',
  'filter.activities': 'Aktivitäten',
  'filter.sources': 'Quellen',
  'filter.reset': 'Filter zurücksetzen',

  // --- Results list ---
  'result.noTitle': 'Ohne Titel',
  'result.author': 'Autor: {name}',
  'result.reportOn': 'Bericht auf {source}',
  'result.emptyViewport': 'Keine Ergebnisse im aktuellen Kartenausschnitt.',
  'result.ageToday': 'Heute',
  'result.ageYesterday': 'Gestern',
  'result.ageDays': '{days} Tage',

  // --- Activity labels ---
  'activity.skitour': 'Skitour',
  'activity.freeride': 'Freeride',
  'activity.snowshoe': 'Schneeschuh',
  'activity.iceclimb': 'Eisklettern',
  'activity.climb': 'Klettern',
  'activity.viaferrata': 'Klettersteig',
  'activity.bike': 'Bike',
  'activity.canyoning': 'Canyoning',
  'activity.paraglide': 'Gleitschirm',
  'activity.mountaineering': 'Hochtour',
  'activity.hike': 'Wanderung',
  'activity.fallback': 'Tour',

  // --- Category filter labels ---
  'category.skitour': 'Skitour',
  'category.schneeschuh': 'Schneeschuhtour',
  'category.eisklettern': 'Eisklettern',
  'category.freeride': 'Freeride',
  'category.klettertour': 'Klettertour',
  'category.klettersteig': 'Klettersteig',
  'category.wanderung': 'Wanderung',
  'category.hochtour': 'Hochtour',
  'category.bike': 'Bike',
  'category.canyoning': 'Canyoning',
  'category.andere': 'anderer Routentyp',

  // --- Shared page-header / back links ---
  'page.backToMap': '← Zurück zur Karte',
  'page.toMapAria': 'Zur Karte',

  // --- index.html / document meta (applied at runtime) ---
  'meta.title': 'Mountain-Radar – Aktuelle Verhältnisberichte aus den Alpen',
  'meta.description':
    'Mountain-Radar bündelt aktuelle Verhältnisberichte für Skitouren, Hochtouren, Freeride und Wanderungen aus den Alpen auf einer interaktiven Karte. One Search. All Conditions.',

  // --- Impressum ---
  'impressum.title': 'Impressum',
  'impressum.owner.h': 'Inhaberin',
  'impressum.owner.p': 'Mountain Radar ist ein Angebot der Bergportal GmbH mit Sitz in Sarnen in der Schweiz.',
  'impressum.address.h': 'Adresse',
  'impressum.contact.h': 'Kontakt',
  'impressum.company.h': 'Firma',
  'impressum.company.reps': 'Vertretungsberechtigte Geschäftsführer sind Reto Baur und Philippe Meyenhofer.',
  'impressum.programming.h': 'Programmierung',
  'impressum.contact.via': 'über',
  'impressum.contact.or': 'oder über',
  'impressum.company.commercialRegister': 'Handelsregister-Firmennummer',
  'impressum.company.uid': 'Unternehmens-Identifikationsnummer (UID)',
  'impressum.company.vat': 'Mehrwertsteuer-Nummer',
};

/*
  Shared Constants: WordGlance Extension
  Common constants used across background, content, and popup scripts
*/

const STORAGE_KEYS = {
  TARGET_LANGUAGE: 'wordglance-target-language',
  SOURCE_LANGUAGE: 'wordglance-source-language',
  DARK_MODE: 'wordglance-dark-mode',
  DISABLED_SITES: 'wordglance-disabled-sites',
  CACHE_DEFINITIONS: 'wordglance-cache-definitions',
  CACHE_TRANSLATIONS: 'wordglance-cache-translations',
  FORM_FIELDS_ENABLED: 'wordglance-form-fields-enabled',
  TRIGGER_POSITION: 'wordglance-trigger-position',
  ENABLE_DEFINITIONS: 'wordglance-enable-definitions',
  ENABLE_TRANSLATIONS: 'wordglance-enable-translations'
};

const DEFAULT_VALUES = {
  TARGET_LANGUAGE: 'en',
  SOURCE_LANGUAGE: 'auto',
  DARK_MODE: false,
  DISABLED_SITES: [],
  FORM_FIELDS_ENABLED: true,
  TRIGGER_POSITION: 'bottom', // 'top' | 'bottom'
  ENABLE_DEFINITIONS: true,
  ENABLE_TRANSLATIONS: true
};

// Single source of truth for the "settings" shape shared by background.js, content.js,
// and popup.js: each entry maps the in-memory settings key to its storage key and default.
// Iterating this (see SettingsUtils in shared-utilities.js) replaces three separate
// hand-written copies of the same key list.
const SETTINGS_SCHEMA = {
  targetLanguage: { storageKey: STORAGE_KEYS.TARGET_LANGUAGE, default: DEFAULT_VALUES.TARGET_LANGUAGE },
  sourceLanguage: { storageKey: STORAGE_KEYS.SOURCE_LANGUAGE, default: DEFAULT_VALUES.SOURCE_LANGUAGE },
  darkMode: { storageKey: STORAGE_KEYS.DARK_MODE, default: DEFAULT_VALUES.DARK_MODE },
  formFieldsEnabled: { storageKey: STORAGE_KEYS.FORM_FIELDS_ENABLED, default: DEFAULT_VALUES.FORM_FIELDS_ENABLED },
  triggerPosition: { storageKey: STORAGE_KEYS.TRIGGER_POSITION, default: DEFAULT_VALUES.TRIGGER_POSITION },
  enableDefinitions: { storageKey: STORAGE_KEYS.ENABLE_DEFINITIONS, default: DEFAULT_VALUES.ENABLE_DEFINITIONS },
  enableTranslations: { storageKey: STORAGE_KEYS.ENABLE_TRANSLATIONS, default: DEFAULT_VALUES.ENABLE_TRANSLATIONS }
};

// Named so the fetch call sites in background.js stay in sync with the host
// permissions declared in manifest.json at a glance.
const API_ENDPOINTS = {
  // The live dictionary provider, which covers the headwords the bundle's
  // cut-off does not reach. A language code and the headword are appended
  // after this.
  //
  // It signals an unknown word with a successful response carrying no entries
  // rather than with a 404, which is what lets "this word has no entry" be
  // told apart from "the request failed". See ADR-0002.
  DICTIONARY: 'https://freedictionaryapi.com/api/v1/entries',
  // The thesaurus, which fills Synonym and Antonym and nothing else, and only
  // when the bundle and the live provider have come up with neither.
  //
  // A relation is asked for by its three-letter code behind a `rel_` prefix.
  // The bare spellings - `syn`, `ant` - answer with an empty list for every
  // word rather than with an error, so a chain built on them would look
  // healthy and return nothing at all.
  THESAURUS: 'https://api.datamuse.com/words',
  // The headword's Wiktionary page, read as raw markup. `action=raw` serves the
  // page's own source and answers 404 when there is no page at all, which is
  // what lets "this word has no equivalents in the reader's Target language" be
  // told apart from "the request failed". See ADR-0003.
  WIKTIONARY: 'https://en.wiktionary.org/w/index.php',
  // The machine-translation fallbacks, in the order the chain asks them. A
  // language and the headword are appended after these.
  //
  // The first is asked first because it answers with a ranked list of
  // alternatives, which several alternatives inside one Target language
  // requires and which a single string can never satisfy. The second is a
  // different vendor on a different host. The third is a different vendor
  // again, and is asked last because it hands out a session token on a page of
  // its own and will not answer without it.
  //
  // All three are undocumented endpoints whose terms prohibit automated access.
  // That risk is accepted knowingly and recorded in ADR-0005, which is also
  // where the chain's ordering and its failure semantics are written down.
  RANKED_ALTERNATIVES: 'https://clients5.google.com/translate_a/single',
  SINGLE_TRANSLATION: 'https://api.mymemory.translated.net/get',
  VENDOR_TRANSLATION: 'https://www.bing.com/ttranslatev3',
  // The page VENDOR_TRANSLATION takes its session token from, and which is
  // therefore fetched before it.
  VENDOR_TRANSLATION_SESSION: 'https://www.bing.com/translator'
};

// The English dictionary that ships inside the package, relative to the
// extension root. The background script reads it with fetch, which resolves this
// against its own document and so never leaves the machine - it needs no host
// permission, and nothing in this repository excludes it from the XPI.
//
// Kept beside API_ENDPOINTS so the two things background.js can fetch are in
// one place: what it asks the network for, and what it already has.
const BUNDLED_DICTIONARY = 'data/wordglance-en-dictionary.json.gz';

const MESSAGE_TYPES = {
  GET_DEFINITION: 'GET_DEFINITION',
  // Answers the Translation Field for one headword, and the pronunciation that
  // came off the same page with it. See ADR-0003.
  GET_TRANSLATION: 'GET_TRANSLATION',
  GET_SETTINGS: 'GET_SETTINGS',
  CLEAR_CACHE: 'CLEAR_CACHE',
  CLEAR_TRANSLATION_CACHE: 'CLEAR_TRANSLATION_CACHE'
};

const LANGUAGES = {
  'auto': 'Auto-detect', 'en': 'English', 'bn': 'Bengali', 'es': 'Spanish',
  'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese',
  'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
  'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'nl': 'Dutch',
  'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish',
  'pl': 'Polish', 'cs': 'Czech', 'sk': 'Slovak', 'hu': 'Hungarian',
  'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sr': 'Serbian',
  'sl': 'Slovenian', 'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian',
  'uk': 'Ukrainian', 'el': 'Greek', 'he': 'Hebrew', 'th': 'Thai',
  'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay', 'tl': 'Filipino',
  'sw': 'Swahili', 'am': 'Amharic', 'zu': 'Zulu'
};

const ERROR_MESSAGES = {
  NO_DEFINITION: 'Definition not found',
  NO_TRANSLATION: 'Translation not found',
  NETWORK_ERROR: 'Connection error - please try again',
  INVALID_WORD: 'Please select a valid word to look up',
  // These two answer the message contract, not a reader: content.js checks the
  // setting before it sends anything, so no reader is shown either sentence.
  // ADR-0007 has the reasoning.
  DEFINITIONS_DISABLED: 'Definitions are turned off in settings',
  TRANSLATIONS_DISABLED: 'Translations are turned off in settings'
};

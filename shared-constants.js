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
  TRIGGER_POSITION: 'top', // 'top' | 'bottom'
  ENABLE_DEFINITIONS: true,
  ENABLE_TRANSLATIONS: true
};

const MESSAGE_TYPES = {
  GET_DEFINITION: 'GET_DEFINITION',
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
  NETWORK_ERROR: 'Connection error - please try again',
  INVALID_WORD: 'Please select a valid word to look up',
  INVALID_TEXT: 'Please select valid text to translate',
  SOURCE_NOT_ENGLISH: 'Definitions are only available for English words'
};

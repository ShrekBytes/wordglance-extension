/*
  Shared Constants: WordGlance Extension
  Common constants used across background, content, and popup scripts
*/

// Storage keys for browser.storage.local
const STORAGE_KEYS = {
  TARGET_LANGUAGE: 'wordglance-target-language',
  SOURCE_LANGUAGE: 'wordglance-source-language',
  DARK_MODE: 'wordglance-dark-mode',
  DISABLED_SITES: 'wordglance-disabled-sites',
  CACHE_DEFINITIONS: 'wordglance-cache-definitions',
  CACHE_TRANSLATIONS: 'wordglance-cache-translations'
};

// Default values for settings
const DEFAULT_VALUES = {
  TARGET_LANGUAGE: 'en',
  SOURCE_LANGUAGE: 'auto',
  DARK_MODE: false,
  DISABLED_SITES: []
};

// Message types for runtime communication
const MESSAGE_TYPES = {
  GET_DEFINITION: 'GET_DEFINITION',
  GET_TRANSLATION: 'GET_TRANSLATION',
  GET_SETTINGS: 'GET_SETTINGS',
  CLEAR_CACHE: 'CLEAR_CACHE',
  CLEAR_TRANSLATION_CACHE: 'CLEAR_TRANSLATION_CACHE'
};

// Supported languages for translation and UI
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

// Error messages
const ERROR_MESSAGES = {
  NO_DEFINITION: 'Definition not found',
  NETWORK_ERROR: 'Connection error - please try again'
};

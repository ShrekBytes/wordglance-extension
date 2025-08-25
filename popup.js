/*
  Popup: Settings UI for WordGlance extension
  Handles language selection, dark mode, cache management, and usage statistics
*/

// Constants
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

const STORAGE_KEYS = {
  TARGET_LANGUAGE: 'wordglance-target-language',
  SOURCE_LANGUAGE: 'wordglance-source-language',
  DARK_MODE: 'wordglance-dark-mode',
  TOTAL_WORDS_LEARNED: 'wordglance-total-words-learned',
  CACHE_DEFINITIONS: 'wordglance-cache-definitions',
  CACHE_TRANSLATIONS: 'wordglance-cache-translations'
};

const DEFAULT_VALUES = {
  TARGET_LANGUAGE: 'en',
  SOURCE_LANGUAGE: 'auto',
  DARK_MODE: false,
  TOTAL_WORDS_LEARNED: 0
};

// Utilities
const getLanguageName = (code) => LANGUAGES[code] || code.toUpperCase();

function renderLanguageOptions(container, includeAuto) {
  container.innerHTML = '';
  Object.entries(LANGUAGES)
    .filter(([code]) => includeAuto || code !== 'auto')
    .forEach(([code, name]) => {
      const div = document.createElement('div');
      div.className = 'language-option';
      div.dataset.code = code;
      div.textContent = name;
      container.appendChild(div);
    });
}

function closeDropdown(prefix) {
  const dropdown = document.querySelector(`#${prefix}-language-dropdown`);
  const search = document.querySelector(`#${prefix}-language-search`);
  const options = document.querySelector(`#${prefix}-language-options`);
  
  if (dropdown) dropdown.classList.remove('open');
  if (search) search.value = '';
  if (options) {
    options.querySelectorAll('.language-option').forEach(opt => opt.style.display = '');
  }
}

function setupSelector(prefix, isSource, currentCode, onChange) {
  const elements = {
    selector: document.querySelector(`#${prefix}-language-selector`),
    dropdown: document.querySelector(`#${prefix}-language-dropdown`),
    search: document.querySelector(`#${prefix}-language-search`),
    options: document.querySelector(`#${prefix}-language-options`),
    label: document.querySelector(`#${prefix}-language-text`)
  };

  // Initialize
  elements.label.textContent = getLanguageName(currentCode);
  renderLanguageOptions(elements.options, isSource);
  
  // Mark selected option
  elements.options.querySelectorAll('.language-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.code === currentCode);
  });

  // Selector click handler
  elements.selector.addEventListener('click', (e) => {
    if (!elements.dropdown.contains(e.target)) {
      e.stopPropagation();
      
      // Close other dropdown
      const otherPrefix = prefix === 'source' ? 'target' : 'source';
      closeDropdown(otherPrefix);
      
      elements.dropdown.classList.toggle('open');
      if (elements.dropdown.classList.contains('open')) {
        setTimeout(() => elements.search.focus(), 50);
      }
    }
  });

  // Prevent dropdown closing on internal clicks
  elements.dropdown.addEventListener('click', e => e.stopPropagation());

  // Search filtering
  elements.search.addEventListener('input', () => {
    const query = elements.search.value.toLowerCase();
    elements.options.querySelectorAll('.language-option').forEach(opt => {
      const text = opt.textContent.toLowerCase();
      const code = opt.dataset.code.toLowerCase();
      opt.style.display = text.includes(query) || code.includes(query) ? '' : 'none';
    });
  });

  // Search escape key
  elements.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown(prefix);
    }
  });

  // Option selection
  elements.options.addEventListener('click', async (e) => {
    const option = e.target.closest('.language-option');
    if (!option) return;
    
    const newCode = option.dataset.code;
    if (newCode !== currentCode) {
      // Update selection
      elements.options.querySelectorAll('.language-option.selected')
        .forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      elements.label.textContent = getLanguageName(newCode);
      
      await onChange(newCode);
    }
    
    closeDropdown(prefix);
  });
}

async function updateCacheInfo(element) {
  const store = await browser.storage.local.get([
    STORAGE_KEYS.CACHE_DEFINITIONS, 
    STORAGE_KEYS.CACHE_TRANSLATIONS
  ]);
  
  let defCount = 0, transCount = 0;
  
  try {
    const defs = JSON.parse(store[STORAGE_KEYS.CACHE_DEFINITIONS] || '{}');
    defCount = Object.keys(defs).length;
  } catch (e) {
    console.warn('Cache parse error (definitions):', e);
  }
  
  try {
    const trans = JSON.parse(store[STORAGE_KEYS.CACHE_TRANSLATIONS] || '{}');
    transCount = Object.keys(trans).length;
  } catch (e) {
    console.warn('Cache parse error (translations):', e);
  }
  
  element.textContent = `Definitions: ${defCount}, Translations: ${transCount}`;
}

function toggleDarkMode(isDark) {
  const app = document.getElementById('wg-settings');
  const methods = isDark ? 'add' : 'remove';
  
  app.classList[methods]('dark-mode');
  document.body.classList[methods]('dark-page');
}

async function clearAllData(usageElement, cacheElement) {
  const confirmed = confirm(
    'Are you sure you want to clear all cached data and reset word counter?\n\n' +
    'This will delete:\n• All cached definitions and translations\n• Words learned counter\n\n' +
    'This action cannot be undone.'
  );
  
  if (!confirmed) return;
  
  await browser.storage.local.set({
    [STORAGE_KEYS.CACHE_DEFINITIONS]: '{}',
    [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}',
    [STORAGE_KEYS.TOTAL_WORDS_LEARNED]: 0
  });
  
  usageElement.textContent = '0';
  updateCacheInfo(cacheElement);
}

async function init() {
  // Get DOM elements
  const elements = {
    app: document.getElementById('wg-settings'),
    darkToggle: document.getElementById('dark-mode'),
    cacheInfo: document.getElementById('cache-info'),
    clearBtn: document.getElementById('clear-cache-btn'),
    usageNumber: document.getElementById('usage-number')
  };

  // Load current settings
  const store = await browser.storage.local.get([
    STORAGE_KEYS.DARK_MODE,
    STORAGE_KEYS.SOURCE_LANGUAGE,
    STORAGE_KEYS.TARGET_LANGUAGE,
    STORAGE_KEYS.TOTAL_WORDS_LEARNED
  ]);

  const settings = {
    isDark: !!store[STORAGE_KEYS.DARK_MODE],
    sourceLang: store[STORAGE_KEYS.SOURCE_LANGUAGE] || DEFAULT_VALUES.SOURCE_LANGUAGE,
    targetLang: store[STORAGE_KEYS.TARGET_LANGUAGE] || DEFAULT_VALUES.TARGET_LANGUAGE,
    wordsLearned: store[STORAGE_KEYS.TOTAL_WORDS_LEARNED] || DEFAULT_VALUES.TOTAL_WORDS_LEARNED
  };

  // Initialize UI
  elements.usageNumber.textContent = String(settings.wordsLearned);
  elements.darkToggle.checked = settings.isDark;
  toggleDarkMode(settings.isDark);

  // Setup dark mode toggle
  elements.darkToggle.addEventListener('change', async () => {
    const isDark = elements.darkToggle.checked;
    await browser.storage.local.set({ [STORAGE_KEYS.DARK_MODE]: isDark });
    toggleDarkMode(isDark);
  });

  // Setup language selectors
  setupSelector('source', true, settings.sourceLang, async (code) => {
    await browser.storage.local.set({ [STORAGE_KEYS.SOURCE_LANGUAGE]: code });
  });

  setupSelector('target', false, settings.targetLang, async (code) => {
    await browser.storage.local.set({ [STORAGE_KEYS.TARGET_LANGUAGE]: code });
    // Clear translation cache when target language changes
    await browser.storage.local.set({ [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}' });
    updateCacheInfo(elements.cacheInfo);
  });

  // Setup cache management
  await updateCacheInfo(elements.cacheInfo);
  elements.clearBtn.addEventListener('click', () => {
    clearAllData(elements.usageNumber, elements.cacheInfo);
  });

  // Global click handler to close dropdowns
  document.addEventListener('click', () => {
    ['source', 'target'].forEach(closeDropdown);
  });
}

init();
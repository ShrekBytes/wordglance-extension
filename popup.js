/*
  Popup: Settings UI for WordGlance extension
  Handles language selection, dark mode, cache management, and usage statistics
*/

// Popup-specific utilities (shared constants loaded from shared-constants.js)

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
    
    // Update selection (always update, even if same language is selected)
    elements.options.querySelectorAll('.language-option.selected')
      .forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    elements.label.textContent = getLanguageName(newCode);
    
    // Always call onChange to ensure the setting is properly saved
    await onChange(newCode);
    
    closeDropdown(prefix);
  });
}

function toggleDarkMode(isDark) {
  const app = document.getElementById('wg-settings');
  const methods = isDark ? 'add' : 'remove';
  
  app.classList[methods]('dark-mode');
  document.body.classList[methods]('dark-page');
}

async function clearCache() {
  const confirmed = confirm(
    'Are you sure you want to clear all cached data?\n\n' +
    'This will delete:\n• All cached definitions and translations\n\n' +
    'Your words learned counter will not be affected.\n' +
    'This action cannot be undone.'
  );
  
  if (!confirmed) return;
  
  // Use background script to clear cache
  try {
    await browser.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_CACHE });
  } catch (e) {
    console.warn('Failed to clear cache:', e);
  }
}

async function init() {
  // Get DOM elements
  const elements = {
    app: document.getElementById('wg-settings'),
    darkToggle: document.getElementById('dark-mode'),
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
    // Update local settings to track current language
    settings.sourceLang = code;
  });

  setupSelector('target', false, settings.targetLang, async (code) => {
    const previousLang = settings.targetLang;
    await browser.storage.local.set({ [STORAGE_KEYS.TARGET_LANGUAGE]: code });
    
    // Only clear translation cache when target language actually changes
    if (code !== previousLang) {
      try {
        await browser.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE });
      } catch (e) {
        console.warn('Failed to clear translation cache:', e);
      }
    }
    
    // Update local settings to track current language
    settings.targetLang = code;
  });

  // Setup cache management
  elements.clearBtn.addEventListener('click', () => {
    clearCache();
  });

  // Global click handler to close dropdowns
  document.addEventListener('click', () => {
    ['source', 'target'].forEach(closeDropdown);
  });
}

init();
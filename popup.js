/*
  Popup: Settings UI for WordGlance extension
  Handles language selection, dark mode, and cache management
*/

// Popup-specific utilities (shared constants loaded from shared-constants.js)
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

  elements.label.textContent = getLanguageName(currentCode);
  renderLanguageOptions(elements.options, isSource);

  elements.options.querySelectorAll('.language-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.code === currentCode);
  });

  elements.selector.addEventListener('click', (e) => {
    // Stop this from bubbling to the document-level listener that closes dropdowns
    // on outside clicks (see init() below) - otherwise opening would immediately
    // be undone by that same click.
    e.stopPropagation();

    const otherPrefix = prefix === 'source' ? 'target' : 'source';
    closeDropdown(otherPrefix);

    elements.dropdown.classList.toggle('open');
    if (elements.dropdown.classList.contains('open')) {
      setTimeout(() => elements.search.focus(), 50);
    }
  });

  // Prevent dropdown closing on internal clicks
  elements.dropdown.addEventListener('click', e => e.stopPropagation());

  elements.search.addEventListener('input', () => {
    const query = elements.search.value.toLowerCase();
    elements.options.querySelectorAll('.language-option').forEach(opt => {
      const text = opt.textContent.toLowerCase();
      const code = opt.dataset.code.toLowerCase();
      opt.style.display = text.includes(query) || code.includes(query) ? '' : 'none';
    });
  });

  elements.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown(prefix);
    }
  });

  elements.options.addEventListener('click', async (e) => {
    const option = e.target.closest('.language-option');
    if (!option) return;

    const newCode = option.dataset.code;

    // Re-apply and persist even if the same language was clicked again, so the UI can't drift from storage
    elements.options.querySelectorAll('.language-option.selected')
      .forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    elements.label.textContent = getLanguageName(newCode);

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
    'This action cannot be undone.'
  );

  if (!confirmed) return;

  await sendMessage({ type: MESSAGE_TYPES.CLEAR_CACHE });
}

// Reads the active tab's hostname (requires activeTab, granted when the popup opens).
// Returns null for pages where a site toggle doesn't make sense (e.g. internal browser pages).
async function getActiveTabHostname() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const { protocol, hostname } = new URL(tab.url);
    return ['http:', 'https:'].includes(protocol) ? hostname : null;
  } catch (e) {
    console.warn('Failed to read active tab:', e);
    return null;
  }
}

// Unchecking this one while its partner is already unchecked forces the partner back on
function setupExclusiveToggle(toggle, partnerToggle, storageKey, partnerStorageKey) {
  toggle.addEventListener('change', async () => {
    const checked = toggle.checked;
    if (!checked && !partnerToggle.checked) {
      partnerToggle.checked = true;
      await StorageUtils.set({ [partnerStorageKey]: true });
    }
    await StorageUtils.set({ [storageKey]: checked });
  });
}

async function setupSiteToggle() {
  const section = document.getElementById('site-toggle-section');
  const toggle = document.getElementById('site-toggle');
  const hostnameLabel = document.getElementById('site-hostname');

  const hostname = await getActiveTabHostname();
  if (!hostname) {
    section.style.display = 'none';
    return;
  }

  hostnameLabel.textContent = `${hostname} — refresh page after changing`;
  toggle.checked = !(await SiteUtils.isSiteDisabled(hostname));

  toggle.addEventListener('change', async () => {
    await SiteUtils.setSiteDisabled(hostname, !toggle.checked);
  });
}

async function init() {
  const elements = {
    darkToggle: document.getElementById('dark-mode'),
    clearBtn: document.getElementById('clear-cache-btn'),
    enableDefinitions: document.getElementById('enable-definitions'),
    enableTranslations: document.getElementById('enable-translations'),
    formFieldsToggle: document.getElementById('form-fields-toggle'),
    positionOptions: document.querySelectorAll('#trigger-position-control .segmented-option')
  };

  // Load current settings (same schema-driven loader background.js and content.js use,
  // so a stored `false`/`0` is never lost and all three stay in sync automatically)
  const settings = await SettingsUtils.loadFromStorage();

  elements.darkToggle.checked = settings.darkMode;
  toggleDarkMode(settings.darkMode);

  elements.darkToggle.addEventListener('change', async () => {
    const isDark = elements.darkToggle.checked;
    await StorageUtils.set({ [STORAGE_KEYS.DARK_MODE]: isDark });
    toggleDarkMode(isDark);
  });

  setupSelector('source', true, settings.sourceLanguage, async (code) => {
    const previousLanguage = settings.sourceLanguage;
    await StorageUtils.set({ [STORAGE_KEYS.SOURCE_LANGUAGE]: code });

    if (code !== previousLanguage) {
      await sendMessage({ type: MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE });
    }

    settings.sourceLanguage = code;
  });

  setupSelector('target', false, settings.targetLanguage, async (code) => {
    const previousLanguage = settings.targetLanguage;
    await StorageUtils.set({ [STORAGE_KEYS.TARGET_LANGUAGE]: code });

    // Only clear translation cache when target language actually changes
    if (code !== previousLanguage) {
      await sendMessage({ type: MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE });
    }

    settings.targetLanguage = code;
  });

  elements.clearBtn.addEventListener('click', clearCache);

  // At least one of definitions/translations must stay enabled (see setupExclusiveToggle)
  elements.enableDefinitions.checked = settings.enableDefinitions;
  elements.enableTranslations.checked = settings.enableTranslations;

  setupExclusiveToggle(elements.enableDefinitions, elements.enableTranslations,
    STORAGE_KEYS.ENABLE_DEFINITIONS, STORAGE_KEYS.ENABLE_TRANSLATIONS);
  setupExclusiveToggle(elements.enableTranslations, elements.enableDefinitions,
    STORAGE_KEYS.ENABLE_TRANSLATIONS, STORAGE_KEYS.ENABLE_DEFINITIONS);

  elements.formFieldsToggle.checked = settings.formFieldsEnabled;
  elements.formFieldsToggle.addEventListener('change', async () => {
    await StorageUtils.set({ [STORAGE_KEYS.FORM_FIELDS_ENABLED]: elements.formFieldsToggle.checked });
  });

  elements.positionOptions.forEach(option => {
    const isSelected = option.dataset.value === settings.triggerPosition;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-pressed', String(isSelected));

    option.addEventListener('click', async () => {
      const value = option.dataset.value;
      elements.positionOptions.forEach(o => {
        const selected = o === option;
        o.classList.toggle('selected', selected);
        o.setAttribute('aria-pressed', String(selected));
      });
      await StorageUtils.set({ [STORAGE_KEYS.TRIGGER_POSITION]: value });
    });
  });

  await setupSiteToggle();

  document.addEventListener('click', () => {
    ['source', 'target'].forEach(closeDropdown);
  });

  document.body.classList.add('popup-ready');
}

init();
const LANGUAGES = {
  'auto': 'Auto-detect','en':'English','bn':'Bengali','es':'Spanish','fr':'French','de':'German','it':'Italian','pt':'Portuguese','ru':'Russian','ja':'Japanese','ko':'Korean','zh':'Chinese','ar':'Arabic','hi':'Hindi','tr':'Turkish','nl':'Dutch','sv':'Swedish','da':'Danish','no':'Norwegian','fi':'Finnish','pl':'Polish','cs':'Czech','sk':'Slovak','hu':'Hungarian','ro':'Romanian','bg':'Bulgarian','hr':'Croatian','sr':'Serbian','sl':'Slovenian','et':'Estonian','lv':'Latvian','lt':'Lithuanian','uk':'Ukrainian','el':'Greek','he':'Hebrew','th':'Thai','vi':'Vietnamese','id':'Indonesian','ms':'Malay','tl':'Filipino','sw':'Swahili','am':'Amharic','zu':'Zulu'
};

function getLanguageName(code) { return LANGUAGES[code] || code.toUpperCase(); }

function renderLanguageOptions(el, includeAuto) {
  el.innerHTML = ''; // clear existing options
  const entries = Object.entries(LANGUAGES).filter(([c]) => includeAuto || c !== 'auto');

  entries.forEach(([code, name]) => {
    const div = document.createElement('div');
    div.className = 'language-option';
    div.dataset.code = code;
    div.textContent = name; // safe! no HTML parsing
    el.appendChild(div);
  });
}

function setupSelector(root, prefix, isSource, currentCode, onChange) {
  const selector = root.querySelector(`#${prefix}-language-selector`);
  const dropdown = root.querySelector(`#${prefix}-language-dropdown`);
  const search = root.querySelector(`#${prefix}-language-search`);
  const options = root.querySelector(`#${prefix}-language-options`);
  const label = root.querySelector(`#${prefix}-language-text`);

  label.textContent = getLanguageName(currentCode);
  renderLanguageOptions(options, isSource);
  // mark selected
  options.querySelectorAll('.language-option').forEach(opt => {
    if (opt.dataset.code === currentCode) opt.classList.add('selected');
  });

  selector.addEventListener('click', (e) => {
    // Don't toggle if clicking on the dropdown itself
    if (!dropdown.contains(e.target)) {
      e.stopPropagation();
      
      // Close other dropdown first
      const otherPrefix = prefix === 'source' ? 'target' : 'source';
      const otherDropdown = root.querySelector(`#${otherPrefix}-language-dropdown`);
      if (otherDropdown) {
        otherDropdown.classList.remove('open');
        const otherSearch = root.querySelector(`#${otherPrefix}-language-search`);
        const otherOptions = root.querySelector(`#${otherPrefix}-language-options`);
        if (otherSearch) otherSearch.value = '';
        if (otherOptions) {
          otherOptions.querySelectorAll('.language-option').forEach(opt => opt.style.display = '');
        }
      }
      
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) {
        // Focus search input when dropdown opens with small delay
        setTimeout(() => search.focus(), 50);
      }
    }
  });

  // Prevent dropdown from closing when clicking inside it
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    options.querySelectorAll('.language-option').forEach(opt => {
      const t = opt.textContent.toLowerCase();
      const c = opt.dataset.code.toLowerCase();
      opt.style.display = t.includes(q) || c.includes(q) ? '' : 'none';
    });
  });

  // Handle Escape key in search
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('open');
      search.value = '';
      options.querySelectorAll('.language-option').forEach(opt => opt.style.display = '');
    }
  });

  options.addEventListener('click', async (e) => {
    const opt = e.target.closest('.language-option');
    if (!opt) return;
    
    const newCode = opt.dataset.code;
    if (newCode !== currentCode) {
      options.querySelectorAll('.language-option.selected').forEach(n => n.classList.remove('selected'));
      opt.classList.add('selected');
      label.textContent = getLanguageName(newCode);
      await onChange(newCode);
    }
    
    // Clear search and close dropdown
    dropdown.classList.remove('open');
    search.value = '';
    options.querySelectorAll('.language-option').forEach(o => o.style.display = '');
  });

  // Global click handler to close dropdown
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    search.value = '';
    options.querySelectorAll('.language-option').forEach(opt => opt.style.display = '');
  });
}

async function updateCacheInfo(el) {
  const store = await browser.storage.local.get(['wordglance-cache-definitions','wordglance-cache-translations']);
  let defs = 0, trans = 0;
  try { const o = JSON.parse(store['wordglance-cache-definitions'] || '{}'); defs = Object.keys(o).length; } catch {}
  try { const o = JSON.parse(store['wordglance-cache-translations'] || '{}'); trans = Object.keys(o).length; } catch {}
  el.textContent = `Definitions: ${defs}, Translations: ${trans}`;
}

async function init() {
  const app = document.getElementById('wg-settings');
  const darkToggle = document.getElementById('dark-mode');
  const cacheInfo = document.getElementById('cache-info');
  const clearBtn = document.getElementById('clear-cache-btn');
  const usageNumber = document.getElementById('usage-number');

  const store = await browser.storage.local.get(['wordglance-dark-mode','wordglance-source-language','wordglance-target-language','wordglance-total-words-learned']);
  const isDark = !!store['wordglance-dark-mode'];
  const sLang = store['wordglance-source-language'] || 'auto';
  const tLang = store['wordglance-target-language'] || 'en';
  const learned = store['wordglance-total-words-learned'] || 0;

  usageNumber.textContent = String(learned);
  darkToggle.checked = isDark;
  if (isDark) {
    app.classList.add('dark-mode');
    document.body.classList.add('dark-page');
  } else {
    app.classList.remove('dark-mode');
    document.body.classList.remove('dark-page');
  }

  // Dark mode
  darkToggle.addEventListener('change', async () => {
    const v = !!darkToggle.checked;
    await browser.storage.local.set({'wordglance-dark-mode': v});
    if (v) {
      app.classList.add('dark-mode');
      document.body.classList.add('dark-page');
    } else {
      app.classList.remove('dark-mode');
      document.body.classList.remove('dark-page');
    }
  });

  // Selectors
  setupSelector(document, 'source', true, sLang, async (code) => {
    await browser.storage.local.set({'wordglance-source-language': code});
  });
  setupSelector(document, 'target', false, tLang, async (code) => {
    await browser.storage.local.set({'wordglance-target-language': code});
    // Clear translation cache on target change
    await browser.storage.local.set({'wordglance-cache-translations': '{}'});
    updateCacheInfo(cacheInfo);
  });

  // Cache info + clear
  await updateCacheInfo(cacheInfo);
  clearBtn.addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to clear all cached data and reset word counter?\n\nThis will delete:\n• All cached definitions and translations\n• Words learned counter\n\nThis action cannot be undone.');
    if (!confirmed) return;
    await browser.storage.local.set({ 'wordglance-cache-definitions': '{}', 'wordglance-cache-translations': '{}', 'wordglance-total-words-learned': 0 });
    usageNumber.textContent = '0';
    updateCacheInfo(cacheInfo);
  });

  // In-page settings opener removed; popup is now the primary settings UI
}

init();
(() => {
  'use strict';

  // --------------------------- Config ---------------------------
  const CONFIG = {
    tooltipZIndex: 999999,
    maxDefinitions: 9,
    maxTranslations: 8,
    definitionsPerPage: 3,
    translationsPerPage: 4,
    maxSynonyms: 6,
    maxAntonyms: 6,
    cacheSize: 500,
    apiTimeout: 5000, // Reduced for faster responses
    debounceDelay: 100, // Debounce delay for selection events (ms)
    animationDuration: 300 // UI animation duration (ms)
  };

  // --------------------------- Storage helpers ---------------------------
  const storage = {
    async get(key, fallback) {
      try {
        const obj = await browser.storage.local.get(key);
        return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
      } catch (e) {
        return fallback;
      }
    },
    async set(key, value) {
      try { await browser.storage.local.set({ [key]: value }); } catch (e) {}
    }
  };

  // --------------------------- State ---------------------------
  let targetLanguage = 'bn';
  let sourceLanguage = 'auto';
  let isDarkMode = false;
  let totalWordsLearned = 0;

  // LRU caches
  const caches = {
    definitions: new Map(),
    translations: new Map()
  };

  // Track active requests for cancellation
  let activeRequests = new Set();

  function lruAdd(map, key, value) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > CONFIG.cacheSize) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
  }

  // --------------------------- Languages ---------------------------
  const LANGUAGES = {
    'auto': 'Auto-detect',
    'en': 'English','bn': 'Bengali','es': 'Spanish','fr': 'French','de': 'German',
    'it': 'Italian','pt': 'Portuguese','ru': 'Russian','ja': 'Japanese','ko': 'Korean',
    'zh': 'Chinese','ar': 'Arabic','hi': 'Hindi','tr': 'Turkish','nl': 'Dutch','sv': 'Swedish',
    'da': 'Danish','no': 'Norwegian','fi': 'Finnish','pl': 'Polish','cs': 'Czech','sk': 'Slovak',
    'hu': 'Hungarian','ro': 'Romanian','bg': 'Bulgarian','hr': 'Croatian','sr': 'Serbian',
    'sl': 'Slovenian','et': 'Estonian','lv': 'Latvian','lt': 'Lithuanian','uk': 'Ukrainian',
    'el': 'Greek','he': 'Hebrew','th': 'Thai','vi': 'Vietnamese','id': 'Indonesian','ms': 'Malay',
    'tl': 'Filipino','sw': 'Swahili','am': 'Amharic','zu': 'Zulu'
  };

  const ERROR_MESSAGES = {
    NO_DEFINITION: 'Definition not found',
    NO_TRANSLATION: 'Translation not available',
    NETWORK_ERROR: 'Connection error - please try again',
    API_TIMEOUT: 'Request timed out - please try again',
    PARSE_ERROR: 'Unable to process response',
    INVALID_INPUT: 'Please select a valid word or phrase',
    LANGUAGE_ERROR: 'Language not supported'
  };

  const createErrorMessage = (type, details = '') => {
    const base = ERROR_MESSAGES[type] || 'Unknown error';
    return details ? `${base}: ${details}` : base;
  };

  // --------------------------- Shadow DOM root ---------------------------
  const host = document.createElement('div');
  host.setAttribute('data-wordglance', '');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.zIndex = String(CONFIG.tooltipZIndex);
  host.style.pointerEvents = 'none';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Styles isolated in shadow
  const style = document.createElement('style');
  style.textContent = `
    .wordglance-tooltip {
      position: absolute;
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 16px;
      max-width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      display: none;
      pointer-events: auto;
      transition: opacity 0.3s ease, transform 0.3s ease;
      word-wrap: break-word;
      overflow-wrap: break-word;
      opacity: 0;
      transform: translateY(-10px) scale(0.95);
      will-change: transform, opacity;
      color: #2c3e50;
      contain: layout style paint; /* CSS containment for better performance */
    }
    .wordglance-tooltip.show { opacity: 1; transform: translateY(0) scale(1); }
    .wordglance-tooltip.dark-mode { background: #1a1a1a; border-color: #333333; color: #e0e0e0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); }
    
    .wordglance-trigger-icon {
      position: absolute;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      font-size: 12px;
      cursor: pointer;
      display: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: transform 0.25s ease, background-color 0.25s ease;
      font-weight: bold;
      opacity: 0;
      transform: scale(0.8);
      will-change: transform, opacity;
      pointer-events: auto;
    }
    /* Larger button for mobile devices */
    @media (hover: none) and (pointer: coarse) {
      .wordglance-trigger-icon {
        width: 32px;
        height: 32px;
        font-size: 16px;
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
      }
    }
    .wordglance-trigger-icon.show { opacity: 1; transform: scale(1); }
    .wordglance-trigger-icon:hover { background: #2980b9; transform: scale(1.1); }
    .wordglance-trigger-icon.dark-mode { background: #ff6b6b; }
    .wordglance-trigger-icon.dark-mode:hover { background: #ff5252; }

    .wordglance-tooltip .definition-section { margin-bottom: 16px; }
    .wordglance-tooltip .translation-section { margin-bottom: 0; }
    
    .wordglance-tooltip .section-title {
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .wordglance-tooltip.dark-mode .section-title { color: #cccccc; }
    
    .wordglance-tooltip .slider-controls { display: flex; gap: 4px; align-items: center; }
    .wordglance-tooltip .slider-button {
      background: none;
      border: none;
      border-radius: 3px;
      width: 20px;
      height: 20px;
      font-size: 12px;
      cursor: pointer;
      color: #7f8c8d;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }
    .wordglance-tooltip .slider-button:hover { color: #2c3e50; }
    .wordglance-tooltip .slider-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wordglance-tooltip .slider-button:disabled:hover { color: inherit; }
    .wordglance-tooltip.dark-mode .slider-button { color: #cccccc; }
    .wordglance-tooltip.dark-mode .slider-button:hover:not(:disabled) { color: #ffffff; }
    .wordglance-tooltip .slider-info { font-size: 11px; color: #7f8c8d; margin: 0 4px; white-space: nowrap; }
    
    .wordglance-tooltip .content-container {
      position: relative;
      overflow: hidden;
      height: auto;
      transition: height 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      will-change: height;
    }
    .wordglance-tooltip .content-slider {
      display: flex;
      transition: transform 0.3s ease;
      width: 100%;
      height: auto;
      will-change: transform;
    }
    .wordglance-tooltip .content-page {
      min-width: 100%;
      max-width: 100%;
      flex-shrink: 0;
      word-wrap: break-word;
      overflow-wrap: break-word;
      box-sizing: border-box;
      height: auto;
    }
    
    .wordglance-tooltip .definition-item {
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f8f9fa;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .wordglance-tooltip.dark-mode .definition-item { border-bottom-color: #333333; }
    .wordglance-tooltip .definition-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    
    .wordglance-tooltip .part-of-speech { color: #7f8c8d; font-style: italic; font-size: 12px; margin-right: 8px; }
    .wordglance-tooltip.dark-mode .part-of-speech { color: #cccccc; }
    .wordglance-tooltip .definition-text {
      color: #2c3e50;
      margin-bottom: 4px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .wordglance-tooltip.dark-mode .definition-text { color: #e0e0e0; }
    
    .wordglance-tooltip .translation-item {
      margin-bottom: 4px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .wordglance-tooltip .translation-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      min-height: 80px;
      position: relative;
      border-radius: 4px;
      overflow: hidden;
    }
    .wordglance-tooltip .translation-grid::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 10%;
      right: 10%;
      height: 2px;
      background: #e0e0e0;
      transform: translateY(-1px);
      z-index: 3;
    }
    .wordglance-tooltip .translation-grid::after {
      content: '';
      position: absolute;
      top: 5%;
      bottom: 5%;
      left: 50%;
      width: 2px;
      background: #e0e0e0;
      transform: translateX(-1px);
      z-index: 3;
    }
    .wordglance-tooltip.dark-mode .translation-grid::before,
    .wordglance-tooltip.dark-mode .translation-grid::after { background: #333333; }
    .wordglance-tooltip .translation-text {
      color: #27ae60;
      font-weight: 500;
      font-size: 14px;
      word-wrap: break-word;
      overflow-wrap: break-word;
      padding: 12px 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 20px;
      background: #ffffff;
      position: relative;
      z-index: 2;
    }
    .wordglance-tooltip.dark-mode .translation-text { color: #4fc3f7; background: #1a1a1a; }
    
    .wordglance-tooltip .example { font-style: italic; color: #7f8c8d; font-size: 12px; margin-top: 4px; }
    .wordglance-tooltip.dark-mode .example { color: #cccccc; }
    .wordglance-tooltip .loading { color: #7f8c8d; font-style: italic; }
    .wordglance-tooltip.dark-mode .loading { color: #cccccc; }
    .wordglance-tooltip .error { color: #e74c3c; font-size: 13px; }
    .wordglance-tooltip.dark-mode .error { color: #ff6b6b; }
    .wordglance-tooltip .info { 
      color:rgb(0, 60, 170); 
      font-size: 14px; 
      font-weight: 600;
      text-align: center; 
      padding: 20px 16px; 
      line-height: 1.4;
      font-style: italic;
    }
    .wordglance-tooltip.dark-mode .info { 
      color:rgb(172, 219, 52); 
    }
    
    .wordglance-tooltip .synonyms-antonyms-section { margin-top: 12px; }
    .wordglance-tooltip .synonyms, .wordglance-tooltip .antonyms { margin-top: 4px; }
    .wordglance-tooltip .synonyms-label, .wordglance-tooltip .antonyms-label { font-weight: 600; color: #2c3e50; }
    .wordglance-tooltip.dark-mode .synonyms-label, .wordglance-tooltip.dark-mode .antonyms-label { color: #cccccc; }
    .wordglance-tooltip .synonyms-list, .wordglance-tooltip .antonyms-list { color: #7f8c8d; font-style: italic; }
    .wordglance-tooltip.dark-mode .synonyms-list, .wordglance-tooltip.dark-mode .antonyms-list { color: #cccccc; }

    /* Settings overlay */
    .wordglance-settings { position:absolute; background:#fff; border:1px solid #e0e0e0; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.15); padding:16px; max-width:400px; min-width:350px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14px; display:none; pointer-events:auto; }
    .wordglance-settings.dark-mode { background:#1a1a1a; border-color:#333; color:#e0e0e0; }
    .wordglance-settings .close-button { position:absolute; top:8px; right:8px; background:none; border:none; font-size:18px; color:#95a5a6; cursor:pointer; padding:4px; line-height:1; }
    .wordglance-settings .settings-header { font-weight:600; font-size:16px; color:#2c3e50; margin-bottom:12px; border-bottom:1px solid #ecf0f1; padding-bottom:8px; }
    .wordglance-settings.dark-mode .settings-header { color:#fff; border-bottom-color:#444; }
    .setting-section { margin-bottom:12px; }
    .setting-item { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; padding:8px 0; }
    .setting-label { color:#2c3e50; font-size:14px; }
    .wordglance-settings.dark-mode .setting-label { color:#e0e0e0; }
    .toggle-switch { position:relative; display:inline-block; width:44px; height:24px; }
    .toggle-switch input { opacity:0; width:0; height:0; }
    .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:#bdc3c7; transition:all .3s; border-radius:24px; }
    .toggle-slider:before { position:absolute; content:""; height:18px; width:18px; left:3px; bottom:3px; background:#fff; transition:all .3s; border-radius:50%; }
    .toggle-switch input:checked + .toggle-slider { background:#3498db; }
    .toggle-switch input:checked + .toggle-slider:before { transform: translateX(20px); }
    .language-selector { background:#f7fafc; border:1px solid #e2e8f0; border-radius:4px; padding:5px 25px 5px 6px; cursor:pointer; font-size:13px; color:#2c3e50; position:relative; min-width:140px; display:flex; align-items:center; justify-content:space-between; }
    .language-selector::after { content:"▼"; position:absolute; right:8px; font-size:11px; color:#7f8c8d; pointer-events:none; }
    .wordglance-settings.dark-mode .language-selector { background:#333; border-color:#666; color:#e0e0e0; }
    .language-dropdown { position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid #e2e8f0; border-radius:4px; margin-top:2px; max-height:200px; overflow-y:auto; box-shadow:0 4px 12px rgba(0,0,0,.15); display:none; z-index:1000; }
    .wordglance-settings.dark-mode .language-dropdown { background:#333; border-color:#666; }
    .language-dropdown.open { display:block; }
    .language-search { width:100%; padding:8px; border:none; border-bottom:1px solid #e2e8f0; font-size:12px; outline:none; background:#f7fafc; color:#2c3e50; }
    .wordglance-settings.dark-mode .language-search { background:#2a2a2a; border-bottom-color:#666; color:#e0e0e0; }
    .language-options { max-height:150px; overflow-y:auto; }
    .language-option { padding:6px 8px; cursor:pointer; font-size:13px; color:#2c3e50; border-bottom:1px solid #f8f9fa; }
    .wordglance-settings.dark-mode .language-option { color:#e0e0e0; border-bottom-color:#444; }
    .language-option.selected { background:#3498db; color:#fff; }
    .cache-button { background:#e74c3c; color:#fff; border:none; border-radius:4px; padding:6px 12px; cursor:pointer; font-size:12px; }
    .cache-info { font-size:11px; color:#7f8c8d; margin-top:4px; font-style:italic; }
    .usage-circle { width:100px; height:100px; border-radius:50%; border:2px solid #3498db; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#3498db; font-weight:bold; margin:0 auto; }
    .usage-number { font-size:24px; line-height:1; }
    .usage-label { font-size:10px; text-transform:lowercase; letter-spacing:.3px; margin-top:4px; }
  .credit-section { border-top:1px solid #e0e0e0; padding-top:20px; margin-top:15px; text-align:center; }
  .wordglance-settings.dark-mode .credit-section { border-top-color:#444; }
  .help-link { display:block; margin-bottom:12px; color:#3498db; text-decoration:none; font-size:14px; }
  .help-link:hover { color:#2980b9; }
  .wordglance-settings.dark-mode .help-link { color:#5dade2; }
  .wordglance-settings.dark-mode .help-link:hover { color:#85c1e9; }
  .credit-text { font-size:13px; color:#7f8c8d; display:flex; align-items:center; justify-content:center; gap:5px; }
  .wordglance-settings.dark-mode .credit-text { color:#ccc; }
  .credit-link { color:#3498db; text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
  .credit-link:hover { color:#2980b9; }
  .wordglance-settings.dark-mode .credit-link { color:#5dade2; }
  .wordglance-settings.dark-mode .credit-link:hover { color:#85c1e9; }
  .github-icon { width:16px; height:16px; vertical-align:middle; }
  `;
  shadow.appendChild(style);

  // Root container to position children absolutely relative to viewport
  const root = document.createElement('div');
  root.className = 'wordglance-root';
  root.style.position = 'fixed';
  root.style.pointerEvents = 'none';
  root.style.top = '0';
  root.style.left = '0';
  root.style.width = '100vw';
  root.style.height = '100vh';
  shadow.appendChild(root);

  function getLanguageName(code) { return LANGUAGES[code] || code.toUpperCase(); }

  // Utility function for debouncing
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

 // --------------------------- UI elements in shadow ---------------------------

// Trigger icon
const triggerIcon = document.createElement('button');
triggerIcon.className = 'wordglance-trigger-icon';
triggerIcon.textContent = '📖';
triggerIcon.style.display = 'none';
triggerIcon.style.position = 'absolute';
triggerIcon.style.pointerEvents = 'auto';
root.appendChild(triggerIcon);

// Tooltip
const tooltip = document.createElement('div');
tooltip.className = 'wordglance-tooltip';
tooltip.style.display = 'none';
tooltip.style.position = 'absolute';
root.appendChild(tooltip);

// -------- Definition Section --------
const defSection = document.createElement('div');
defSection.className = 'definition-section';

const defTitle = document.createElement('div');
defTitle.className = 'section-title';
const wordTitle = document.createElement('span');
wordTitle.className = 'word-title';
wordTitle.textContent = 'Word';
defTitle.appendChild(wordTitle);

// Slider controls
const defSliderControls = document.createElement('div');
defSliderControls.className = 'slider-controls';

const defPrev = document.createElement('button');
defPrev.className = 'slider-button definition-prev';
defPrev.textContent = '‹';
defSliderControls.appendChild(defPrev);

const defInfo = document.createElement('span');
defInfo.className = 'slider-info definition-info';
defInfo.textContent = '1/1';
defSliderControls.appendChild(defInfo);

const defNext = document.createElement('button');
defNext.className = 'slider-button definition-next';
defNext.textContent = '›';
defSliderControls.appendChild(defNext);

defTitle.appendChild(defSliderControls);
defSection.appendChild(defTitle);

// Content container
const defContentContainer = document.createElement('div');
defContentContainer.className = 'content-container';
const defSliderDiv = document.createElement('div');
defSliderDiv.className = 'content-slider definition-slider';
const defPage = document.createElement('div');
defPage.className = 'content-page';
const defContent = document.createElement('div');
defContent.className = 'definition-content loading';
defContent.textContent = 'Loading...';
defPage.appendChild(defContent);
defSliderDiv.appendChild(defPage);
defContentContainer.appendChild(defSliderDiv);
defSection.appendChild(defContentContainer);

tooltip.appendChild(defSection);

// -------- Translation Section --------
const transSection = document.createElement('div');
transSection.className = 'translation-section';

const transTitle = document.createElement('div');
transTitle.className = 'section-title';
const transSpan = document.createElement('span');
transSpan.className = 'translation-title';
transSpan.textContent = 'Loading...';
transTitle.appendChild(transSpan);

const transSliderControls = document.createElement('div');
transSliderControls.className = 'slider-controls';

const transPrev = document.createElement('button');
transPrev.className = 'slider-button translation-prev';
transPrev.textContent = '‹';
transSliderControls.appendChild(transPrev);

const transInfo = document.createElement('span');
transInfo.className = 'slider-info translation-info';
transInfo.textContent = '1/1';
transSliderControls.appendChild(transInfo);

const transNext = document.createElement('button');
transNext.className = 'slider-button translation-next';
transNext.textContent = '›';
transSliderControls.appendChild(transNext);

transTitle.appendChild(transSliderControls);
transSection.appendChild(transTitle);

// Content container
const transContentContainer = document.createElement('div');
transContentContainer.className = 'content-container';
const transSliderDiv = document.createElement('div');
transSliderDiv.className = 'content-slider translation-slider';
const transPage = document.createElement('div');
transPage.className = 'content-page';
const transContent = document.createElement('div');
transContent.className = 'translation-content loading';
transContent.textContent = 'Loading...';
transPage.appendChild(transContent);
transSliderDiv.appendChild(transPage);
transContentContainer.appendChild(transSliderDiv);
transSection.appendChild(transContentContainer);

tooltip.appendChild(transSection);

// -------- Synonyms & Antonyms Section --------
const synSection = document.createElement('div');
synSection.className = 'synonyms-antonyms-section';
synSection.style.display = 'none';
const synContent = document.createElement('div');
synContent.className = 'synonyms-antonyms-content';
synSection.appendChild(synContent);
tooltip.appendChild(synSection);

// --------------------------- Settings Overlay ---------------------------
const settings = document.createElement('div');
settings.className = 'wordglance-settings';
settings.style.display = 'none';
root.appendChild(settings);

// Close button
const closeBtn = document.createElement('button');
closeBtn.className = 'close-button';
closeBtn.textContent = '×';
settings.appendChild(closeBtn);

// Header
const settingsHeader = document.createElement('div');
settingsHeader.className = 'settings-header';
settingsHeader.textContent = '⚙️ Settings';
settings.appendChild(settingsHeader);

// -------- Dark Mode Section --------
const darkSection = document.createElement('div');
darkSection.className = 'setting-section';
const darkItem = document.createElement('div');
darkItem.className = 'setting-item';
const darkLabel = document.createElement('div');
darkLabel.className = 'setting-label';
darkLabel.textContent = 'Dark Mode';
darkItem.appendChild(darkLabel);

const toggleLabel = document.createElement('label');
toggleLabel.className = 'toggle-switch';
const toggleInput = document.createElement('input');
toggleInput.type = 'checkbox';
toggleInput.id = 'dark-mode-toggle';
const toggleSlider = document.createElement('span');
toggleSlider.className = 'toggle-slider';
toggleLabel.appendChild(toggleInput);
toggleLabel.appendChild(toggleSlider);
darkItem.appendChild(toggleLabel);

darkSection.appendChild(darkItem);
settings.appendChild(darkSection);

// -------- Source Language Section --------
const sourceSection = document.createElement('div');
sourceSection.className = 'setting-section';
const sourceItem = document.createElement('div');
sourceItem.className = 'setting-item';

const sourceLabelWrapper = document.createElement('div');
sourceLabelWrapper.className = 'setting-label';
const sourceLabel = document.createElement('div');
sourceLabel.textContent = 'From Language';
const sourceCacheInfo = document.createElement('div');
sourceCacheInfo.className = 'cache-info';
sourceCacheInfo.textContent = 'Use auto for best experience';
sourceLabelWrapper.appendChild(sourceLabel);
sourceLabelWrapper.appendChild(sourceCacheInfo);
sourceItem.appendChild(sourceLabelWrapper);

// Language selector
const sourceSelector = document.createElement('div');
sourceSelector.className = 'language-selector';
sourceSelector.id = 'source-language-selector';
const sourceText = document.createElement('span');
sourceText.className = 'language-text';
sourceText.textContent = 'Auto-detect';
const sourceDropdown = document.createElement('div');
sourceDropdown.className = 'language-dropdown';
sourceDropdown.id = 'source-language-dropdown';
const sourceInput = document.createElement('input');
sourceInput.type = 'text';
sourceInput.className = 'language-search';
sourceInput.id = 'source-language-search';
sourceInput.placeholder = 'Search languages...';
const sourceOptions = document.createElement('div');
sourceOptions.className = 'language-options';
sourceOptions.id = 'source-language-options';

sourceDropdown.appendChild(sourceInput);
sourceDropdown.appendChild(sourceOptions);
sourceSelector.appendChild(sourceText);
sourceSelector.appendChild(sourceDropdown);
sourceItem.appendChild(sourceSelector);
sourceSection.appendChild(sourceItem);
settings.appendChild(sourceSection);

// -------- Target Language Section --------
const targetSection = document.createElement('div');
targetSection.className = 'setting-section';
const targetItem = document.createElement('div');
targetItem.className = 'setting-item';

const targetLabelWrapper = document.createElement('div');
targetLabelWrapper.className = 'setting-label';
const targetLabel = document.createElement('div');
targetLabel.textContent = 'To Language';
targetLabelWrapper.appendChild(targetLabel);
targetItem.appendChild(targetLabelWrapper);

const targetSelector = document.createElement('div');
targetSelector.className = 'language-selector';
targetSelector.id = 'target-language-selector';
const targetText = document.createElement('span');
targetText.className = 'language-text';
targetText.textContent = getLanguageName(targetLanguage);
const targetDropdown = document.createElement('div');
targetDropdown.className = 'language-dropdown';
targetDropdown.id = 'target-language-dropdown';
const targetInput = document.createElement('input');
targetInput.type = 'text';
targetInput.className = 'language-search';
targetInput.id = 'target-language-search';
targetInput.placeholder = 'Search languages...';
const targetOptions = document.createElement('div');
targetOptions.className = 'language-options';
targetOptions.id = 'target-language-options';

targetDropdown.appendChild(targetInput);
targetDropdown.appendChild(targetOptions);
targetSelector.appendChild(targetText);
targetSelector.appendChild(targetDropdown);
targetItem.appendChild(targetSelector);
targetSection.appendChild(targetItem);
settings.appendChild(targetSection);

// -------- Cache Section --------
const cacheSection = document.createElement('div');
cacheSection.className = 'setting-section';
const cacheItem = document.createElement('div');
cacheItem.className = 'setting-item';

const cacheLabelWrapper = document.createElement('div');
cacheLabelWrapper.className = 'setting-label';
const cacheLabel = document.createElement('div');
cacheLabel.textContent = 'Cache';
const cacheInfo = document.createElement('div');
cacheInfo.className = 'cache-info';
cacheInfo.id = 'cache-info';
cacheInfo.textContent = 'Loading...';
cacheLabelWrapper.appendChild(cacheLabel);
cacheLabelWrapper.appendChild(cacheInfo);
cacheItem.appendChild(cacheLabelWrapper);

const cacheBtn = document.createElement('button');
cacheBtn.className = 'cache-button';
cacheBtn.id = 'clear-cache-btn';
cacheBtn.textContent = 'Clear';
cacheItem.appendChild(cacheBtn);

cacheSection.appendChild(cacheItem);
settings.appendChild(cacheSection);

// -------- Usage Section --------
const usageSection = document.createElement('div');
usageSection.className = 'setting-section';
const usageCircle = document.createElement('div');
usageCircle.className = 'usage-circle';
const usageNumber = document.createElement('div');
usageNumber.className = 'usage-number';
usageNumber.textContent = '0';
const usageLabel = document.createElement('div');
usageLabel.className = 'usage-label';
usageLabel.textContent = 'words learned';
usageCircle.appendChild(usageNumber);
usageCircle.appendChild(usageLabel);
usageSection.appendChild(usageCircle);
settings.appendChild(usageSection);

// -------- Credit Section --------
const creditSection = document.createElement('div');
creditSection.className = 'credit-section';
const helpLink = document.createElement('a');
helpLink.href = 'https://github.com/ShrekBytes/WordGlance/issues';
helpLink.target = '_blank';
helpLink.className = 'help-link';
helpLink.textContent = 'Need help?';
creditSection.appendChild(helpLink);

const creditText = document.createElement('div');
creditText.className = 'credit-text';
creditText.textContent = 'Made by ';

const creditLink = document.createElement('a');
creditLink.href = 'https://github.com/ShrekBytes/WordGlance';
creditLink.target = '_blank';
creditLink.className = 'credit-link';

// GitHub icon SVG
creditLink.innerHTML = `
<svg class="github-icon" viewBox="0 0 16 16" fill="currentColor">
<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
</svg>
ShrekBytes
`;

creditText.appendChild(creditLink);
creditSection.appendChild(creditText);
settings.appendChild(creditSection);

// Apply dark mode function
function applyDarkMode() {
  if (isDarkMode) {
    triggerIcon.classList.add('dark-mode');
    tooltip.classList.add('dark-mode');
    settings.classList.add('dark-mode');
  } else {
    triggerIcon.classList.remove('dark-mode');
    tooltip.classList.remove('dark-mode');
    settings.classList.remove('dark-mode');
  }
}


  // --------------------------- Load persisted settings ---------------------------
  (async function initSettings() {
    targetLanguage = await storage.get('wordglance-target-language', 'en');
    sourceLanguage = await storage.get('wordglance-source-language', 'auto');
    isDarkMode = await storage.get('wordglance-dark-mode', false);
    totalWordsLearned = await storage.get('wordglance-total-words-learned', 0);
    // load caches
    try {
      const d = await storage.get('wordglance-cache-definitions', '{}');
      const t = await storage.get('wordglance-cache-translations', '{}');
      const def = JSON.parse(d); const tra = JSON.parse(t);
      Object.keys(def).forEach(k => lruAdd(caches.definitions, k, def[k]));
      Object.keys(tra).forEach(k => lruAdd(caches.translations, k, tra[k]));
    } catch {}

    // update UI
    settings.querySelector('#dark-mode-toggle').checked = isDarkMode;
    settings.querySelector('.usage-number').textContent = String(totalWordsLearned);
    settings.querySelector('#source-language-selector .language-text').textContent = getLanguageName(sourceLanguage);
    settings.querySelector('#target-language-selector .language-text').textContent = getLanguageName(targetLanguage);
    const sourceOptions = settings.querySelector('#source-language-options');
    sourceOptions.textContent = ''; // clear
    
    Object.entries(LANGUAGES).forEach(([code, name]) => {
      const opt = document.createElement('div');
      opt.className = 'language-option';
      if (code === sourceLanguage) opt.classList.add('selected');
      opt.dataset.code = code;
      opt.textContent = name;
      sourceOptions.appendChild(opt);
    });
    const targetOptions = settings.querySelector('#target-language-options');
    targetOptions.textContent = ''; // clear

    Object.entries(LANGUAGES).filter(([c])=>c!=='auto').forEach(([code, name]) => {
      const opt = document.createElement('div');
      opt.className = 'language-option';
      if (code === targetLanguage) opt.classList.add('selected');
      opt.dataset.code = code;
      opt.textContent = name;
      targetOptions.appendChild(opt);
    });
    applyDarkMode();
    updateCacheInfo();
    updateTranslationTitle();
  })();

  function updateCacheInfo() {
    const info = settings.querySelector('#cache-info');
    if (!info) return;
    const defs = caches.definitions.size;
    const trans = caches.translations.size;
    info.textContent = `Definitions: ${defs}, Translations: ${trans}`;
  }

  // --------------------------- Selection handling ---------------------------
  let currentSelection = '';
  let selectionRect = null;
  let selectionRange = null;

  function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Basic sanitization
    let s = text.trim();
    
    // Remove dangerous characters and control characters
    s = s.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Remove control characters
    s = s.replace(/[<>'"&]/g, ''); // Remove HTML special characters
    
    // Length validation
    if (s.length === 0 || s.length > 100) return '';
    
    // Word count validation
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 5) return '';
    
    // Content validation - Simple check that works across all environments
    // Allow word characters, spaces, common punctuation, and basic Unicode ranges
    if (!/^[\w\u00C0-\u024F\u0300-\u036F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u200c\u200d\s\-\'\.\,\;\:\!\?]+$/.test(s)) return '';
    
    // Exclude pure numbers
    if (/^\d+$/.test(s)) return '';
    
    // Must contain at least one letter (basic check for common scripts)
    if (!/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(s)) return '';
    
    return s;
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sanitizeText(sel.toString());
    if (!text) return null;
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return { text, range, rect };
    } catch { return null; }
  }

  function positionTriggerIcon(x, y) {
    // Userscript-like positioning with mobile awareness
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const buttonSize = isMobile ? 32 : 24;
    const halfButton = buttonSize / 2;
    let left, top;
    if (isMobile) {
      left = Math.max(10, Math.min(x - halfButton, window.innerWidth - buttonSize - 10));
      top = y + 40;
      if (top + buttonSize > window.innerHeight - 50) {
        left = Math.min(x + 20, window.innerWidth - buttonSize - 10);
        top = Math.max(10, y - halfButton);
        if (left + buttonSize > window.innerWidth - 10) left = Math.max(10, x - buttonSize - 20);
      }
    } else {
      left = x + 10;
      top = y - 30;
      if (left + buttonSize > window.innerWidth) left = x - buttonSize - 10;
      if (top < 0) top = y + 10;
    }
    triggerIcon.style.left = `${left}px`;
    triggerIcon.style.top = `${top}px`;
  }

  let triggerHideTimer = null;
  function showTrigger(persist = false) {
    if (triggerHideTimer) { clearTimeout(triggerHideTimer); triggerHideTimer = null; }
    triggerIcon.style.display = 'block';
    requestAnimationFrame(() => triggerIcon.classList.add('show'));
    if (!persist) {
      // optional auto hide after inactivity; disabled by default but logic retained
    }
  }
  function hideTrigger(immediate = false) {
    if (immediate) {
      triggerIcon.classList.remove('show');
      triggerIcon.style.display = 'none';
      return;
    }
    triggerIcon.classList.remove('show');
    setTimeout(()=>{ if (!triggerIcon.classList.contains('show')) triggerIcon.style.display = 'none'; }, 250);
  }

  function hideTooltip() {
    tooltip.classList.remove('show');
    setTimeout(()=>{ 
      tooltip.style.display = 'none'; 
      // Clear all content when tooltip is hidden
      clearTooltipContent();
    }, 200);
  }

  function clearTooltipContent() {
    // Clear definition slider
    const defSlider = tooltip.querySelector('.definition-slider');
    if (defSlider) {
      defSlider.textContent = '';
    }
    
    // Clear translation slider
    const trSlider = tooltip.querySelector('.translation-slider');
    if (trSlider) {
      trSlider.textContent = '';
    }
    
    // Clear synonyms and antonyms
    renderSynAnt([], []);
    
    // Reset page counters
    currentDefinitionPage = 0;
    currentTranslationPage = 0;
    
    // Clear page height arrays
    definitionPageHeights = [];
    translationPageHeights = [];
  }

  function onSelectionEvent() {
    const info = getSelectionInfo();
    if (!info) { hideTrigger(); return; }
    currentSelection = info.text;
    selectionRect = info.rect;
    selectionRange = info.range;
  const cx = selectionRect.left + (selectionRect.width / 2);
  const cy = selectionRect.top;
  positionTriggerIcon(cx, cy);
  showTrigger(true);
  }

  // Debounced selection handler for better performance
  const debouncedSelectionHandler = debounce(onSelectionEvent, CONFIG.debounceDelay);

  document.addEventListener('mouseup', onSelectionEvent, true);
  document.addEventListener('keyup', (e)=>{
    if (e.key === 'Escape') { hideTooltip(); hideTrigger(); return; }
    debouncedSelectionHandler();
  }, true);
  document.addEventListener('touchend', () => setTimeout(debouncedSelectionHandler, 100), { passive: true });
  document.addEventListener('selectionchange', () => {
    // Only handle if this is likely a user-initiated selection
    if (document.hasFocus()) {
      setTimeout(debouncedSelectionHandler, 150);
    }
  });
  window.addEventListener('scroll', () => { if (selectionRect) { const info = getSelectionInfo(); if (info) { selectionRect = info.rect; const cx = selectionRect.left + selectionRect.width/2; const cy = selectionRect.top; positionTriggerIcon(cx, cy); showTrigger(true); } } }, { passive: true });
  window.addEventListener('resize', () => { if (selectionRect) { const info = getSelectionInfo(); if (info) { selectionRect = info.rect; const cx = selectionRect.left + selectionRect.width/2; const cy = selectionRect.top; positionTriggerIcon(cx, cy); showTrigger(true); } } });

  // --------------------------- Fetch helpers ---------------------------
  async function xfetch(url, init = {}) {
    // Try direct fetch first (host permissions should allow). If fails, use background proxy.
    const ac = new AbortController();
    const to = setTimeout(()=>ac.abort(), CONFIG.apiTimeout);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(to);
      return res;
    } catch (e) {
      clearTimeout(to);
      try {
        const resp = await browser.runtime.sendMessage({ type: 'WORDGLANCE_FETCH', url, init });
        if (!resp) throw new Error('No response');
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          text: async () => resp.text,
          json: async () => { try { return JSON.parse(resp.text); } catch (err) { throw err; } }
        };
      } catch (e2) {
        throw e2;
      }
    }
  }

  function saveCaches() {
    const defObj = Object.fromEntries(caches.definitions.entries());
    const transObj = Object.fromEntries(caches.translations.entries());
    storage.set('wordglance-cache-definitions', JSON.stringify(defObj));
    storage.set('wordglance-cache-translations', JSON.stringify(transObj));
  }

  // Cancel active requests to prevent race conditions
  function cancelActiveRequests() {
    activeRequests.clear();
  }

  async function fetchDefinition(word) {
    // Check cache first for instant response
    const key = word.toLowerCase();
    const cached = caches.definitions.get(key);
    if (cached) return cached;
    
    const requestId = `def-${word}-${Date.now()}`;
    activeRequests.add(requestId);
    
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`;
    try {
      const res = await xfetch(url);
      
      // Check if request is still active (not cancelled by newer request)
      if (!activeRequests.has(requestId)) {
        return; // Ignore outdated response
      }
      activeRequests.delete(requestId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Normalize: flatten meanings/definitions
      const defs = [];
      const syns = new Set();
      const ants = new Set();
      (data || []).forEach(entry => {
        (entry.meanings || []).forEach(m => {
          // Collect synonyms and antonyms from meaning level (like userscript)
          const meaningSynonyms = m.synonyms || [];
          const meaningAntonyms = m.antonyms || [];
          meaningSynonyms.forEach(s => syns.add(s));
          meaningAntonyms.forEach(a => ants.add(a));
          
          (m.definitions || []).forEach(d => {
            if (d.definition) defs.push({ definition: d.definition, partOfSpeech: m.partOfSpeech || '', example: d.example || '' });
            // Collect synonyms and antonyms from definition level
            (d.synonyms||[]).forEach(s=>syns.add(s));
            (d.antonyms||[]).forEach(a=>ants.add(a));
          });
        });
      });
      
      // Limit synonyms and antonyms like userscript
      const result = { 
        defs: defs.slice(0, CONFIG.maxDefinitions), 
        synonyms: Array.from(syns).slice(0, CONFIG.maxSynonyms), 
        antonyms: Array.from(ants).slice(0, CONFIG.maxAntonyms) 
      };
      lruAdd(caches.definitions, key, result); saveCaches();
      return result;
    } catch (e) {
      activeRequests.delete(requestId);
      throw new Error(createErrorMessage('NETWORK_ERROR'));
    }
  }

  async function fetchTranslation(text) {
    // Check cache first for instant response
    const key = `${text}::${sourceLanguage}::${targetLanguage}`;
    if (caches.translations.has(key)) return caches.translations.get(key);
    
    const requestId = `trans-${text}-${sourceLanguage}-${targetLanguage}-${Date.now()}`;
    activeRequests.add(requestId);
    
    const params = new URLSearchParams();
    params.set('dl', targetLanguage);
    params.set('text', text);
    if (sourceLanguage !== 'auto') params.set('sl', sourceLanguage);
    const url = `https://ftapi.pythonanywhere.com/translate?${params.toString()}`;
    try {
      const res = await xfetch(url);
      
      // Check if request is still active (not cancelled by newer request)
      if (!activeRequests.has(requestId)) {
        return; // Ignore outdated response
      }
      activeRequests.delete(requestId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translations = [];
      if (data && data['destination-text']) {
        translations.push(data['destination-text']);
        if (data.translations && data.translations['all-translations']) {
          const all = data.translations['all-translations'];
          for (const group of all) {
            if (Array.isArray(group) && group.length) {
              const t = group[0];
              if (t && t !== data['destination-text'] && !translations.includes(t)) translations.push(t);
              if (translations.length >= CONFIG.maxTranslations) break;
            }
          }
        }
        if (translations.length < CONFIG.maxTranslations && data.translations && data.translations['possible-translations']) {
          const extra = data.translations['possible-translations'].filter(t => t && !translations.includes(t));
          translations.push(...extra.slice(0, CONFIG.maxTranslations - translations.length));
        }
      }
      const result = { translations: translations.slice(0, CONFIG.maxTranslations) };
      lruAdd(caches.translations, key, result); saveCaches();
      return result;
    } catch (e) {
      activeRequests.delete(requestId);
      throw new Error(createErrorMessage('NETWORK_ERROR'));
    }
  }

  // --------------------------- Tooltip rendering & pagination ---------------------------
  let currentDefinitionPage = 0;
  let currentTranslationPage = 0;
  let definitionPages = [];
  let translationPages = [];
  // Cache per-page heights for smooth container transitions
  let definitionPageHeights = [];
  let translationPageHeights = [];

  function paginate(array, perPage) {
    const pages = [];
    for (let i = 0; i < array.length; i += perPage) {
      pages.push(array.slice(i, i + perPage));
    }
    return pages.length ? pages : [[]];
  }

  function updateTranslationTitle() {
    const t = tooltip.querySelector('.translation-title');
  if (t) t.textContent = `${sourceLanguage === 'auto' ? 'Auto' : getLanguageName(sourceLanguage)} → ${getLanguageName(targetLanguage)}`;
  }

  function renderDefinitionPages(defs) {
    const slider = tooltip.querySelector('.definition-slider');
    const info = tooltip.querySelector('.definition-info');
    const prev = tooltip.querySelector('.definition-prev');
    const next = tooltip.querySelector('.definition-next');
    definitionPages = paginate(defs.slice(0, CONFIG.maxDefinitions), CONFIG.definitionsPerPage);
    currentDefinitionPage = 0;
    slider.textContent = ''; // clear old pages
    definitionPages.forEach(page => {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'content-page';
      if (!page.length) {
        const errDiv = document.createElement('div');
        errDiv.className = 'definition-content error';
        errDiv.textContent = createErrorMessage('NO_DEFINITION');
        pageDiv.appendChild(errDiv);
      } else {
        page.forEach(d => {
          const defDiv = document.createElement('div');
          defDiv.className = 'definition-item';
          if (d.partOfSpeech) {
            const pos = document.createElement('span');
            pos.className = 'part-of-speech';
            pos.textContent = d.partOfSpeech;
            defDiv.appendChild(pos);
          }
          const text = document.createElement('div');
          text.className = 'definition-text';
          text.textContent = d.definition;
          defDiv.appendChild(text);
          if (d.example) {
            const ex = document.createElement('div');
            ex.className = 'example';
            ex.textContent = d.example;
            defDiv.appendChild(ex);
          }
          pageDiv.appendChild(defDiv);
        });
      }
      slider.appendChild(pageDiv);
    });
    
  // Measure page heights
  definitionPageHeights = Array.from(slider.children).map(page => measurePageHeight(page));
  // Sync height and controls
  updateSlider(slider, info, prev, next, currentDefinitionPage, definitionPages.length, 'definition');
  // Sync height after transform transitions
  attachSliderHeightSync('definition');
  }

  function renderSynAnt(synonyms, antonyms) {
    const section = tooltip.querySelector('.synonyms-antonyms-section');
    const cont = tooltip.querySelector('.synonyms-antonyms-content');
    if (!section || !cont) return;
  
    cont.textContent = ''; // clear previous content
  
    let hasContent = false;
  
    if (synonyms && synonyms.length) {
      const synDiv = document.createElement('div');
      synDiv.className = 'synonyms';
  
      const label = document.createElement('span');
      label.className = 'synonyms-label';
      label.textContent = 'Synonyms: ';
      synDiv.appendChild(label);
  
      const list = document.createElement('span');
      list.className = 'synonyms-list';
      list.textContent = synonyms.slice(0, CONFIG.maxSynonyms).join(', ');
      synDiv.appendChild(list);
  
      cont.appendChild(synDiv);
      hasContent = true;
    }
  
    if (antonyms && antonyms.length) {
      const antDiv = document.createElement('div');
      antDiv.className = 'antonyms';
  
      const label = document.createElement('span');
      label.className = 'antonyms-label';
      label.textContent = 'Antonyms: ';
      antDiv.appendChild(label);
  
      const list = document.createElement('span');
      list.className = 'antonyms-list';
      list.textContent = antonyms.slice(0, CONFIG.maxAntonyms).join(', ');
      antDiv.appendChild(list);
  
      cont.appendChild(antDiv);
      hasContent = true;
    }
  
    section.style.display = hasContent ? '' : 'none';
  }  

  function renderTranslationPages(items) {
    const slider = tooltip.querySelector('.translation-slider');
    const info = tooltip.querySelector('.translation-info');
    const prev = tooltip.querySelector('.translation-prev');
    const next = tooltip.querySelector('.translation-next');
    translationPages = paginate(items.slice(0, CONFIG.maxTranslations), CONFIG.translationsPerPage);
    currentTranslationPage = 0;
    slider.textContent = ''; // clear old pages
    translationPages.forEach(page => {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'content-page';
      const grid = document.createElement('div');
      grid.className = 'translation-grid';
      for (let i = 0; i < 4; i++) {
        const cell = document.createElement('div');
        cell.className = 'translation-text';
        if (page[i]) cell.textContent = page[i];
        grid.appendChild(cell);
      }
      pageDiv.appendChild(grid);
      slider.appendChild(pageDiv);
    });
    
    // Measure page heights
    translationPageHeights = Array.from(slider.children).map(page => measurePageHeight(page));
    // Sync height and controls
    updateSlider(slider, info, prev, next, currentTranslationPage, translationPages.length, 'translation');
    // Sync height after transform transitions
    attachSliderHeightSync('translation');
  }

  function updateSlider(slider, info, prev, next, index, total, kind) {
    slider.style.transform = `translateX(-${index * 100}%)`;
    info.textContent = `${Math.min(index+1,total)}/${total || 1}`;
    prev.disabled = index <= 0;
    next.disabled = index >= total - 1;
    // Adjust container height smoothly based on measured heights
    if (kind) {
      const container = slider.closest('.content-container');
      const heights = kind === 'definition' ? definitionPageHeights : translationPageHeights;
      const target = heights[index] || (slider.children[index]?.scrollHeight || 0);
      if (container && target) smoothHeightTransition(container, target);
    }
  }

  function smoothHeightTransition(container, targetHeight, immediate = false) {
    if (!container) return;
    if (immediate) {
      const prev = container.style.transition;
      container.style.transition = 'none';
      container.style.height = targetHeight + 'px';
      requestAnimationFrame(()=>{ container.style.transition = prev || 'height 0.4s cubic-bezier(0.25,0.46,0.45,0.94)'; });
    } else {
      container.style.height = targetHeight + 'px';
    }
  }

  function measurePageHeight(page) {
    const prevStyle = page.getAttribute('style') || '';
    page.style.position = 'absolute';
    page.style.visibility = 'hidden';
    page.style.left = '-10000px';
    page.style.top = '0';
    page.style.height = 'auto';
    const height = page.scrollHeight;
    page.setAttribute('style', prevStyle);
    return height;
  }

  function attachSliderHeightSync(kind) {
    const slider = tooltip.querySelector(`.${kind}-slider`);
    if (!slider) return;
    const handler = (e) => {
      if (e.propertyName === 'transform') {
        const container = slider.closest('.content-container');
        const index = kind === 'definition' ? currentDefinitionPage : currentTranslationPage;
        const heights = kind === 'definition' ? definitionPageHeights : translationPageHeights;
        const target = heights[index] || (slider.children[index]?.scrollHeight || 0);
        if (container && target) smoothHeightTransition(container, target);
      }
    };
    // Avoid duplicate listeners
    if (slider._heightHandler) slider.removeEventListener('transitionend', slider._heightHandler);
    slider.addEventListener('transitionend', handler);
    slider._heightHandler = handler;
  }

  function positionTooltipNearRect(rect) {
    const margin = 20; // mirror userscript comfortable bounds
    const tRect = tooltip.getBoundingClientRect();
    let left = rect.left + 10;
    let top = rect.top - (tRect.height || 120) - 10; // estimate before paint
    const vw = window.innerWidth, vh = window.innerHeight;
    if (left + (tRect.width||320) > vw - margin) left = rect.right - (tRect.width||320) - 10;
    if (top < margin) top = rect.bottom + 20;
    left = Math.max(margin, Math.min(left, vw - (tRect.width||320) - margin));
    top = Math.max(margin, Math.min(top, vh - 180 - margin));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  tooltip.querySelector('.definition-prev').addEventListener('click', () => {
    if (currentDefinitionPage <= 0) return;
    currentDefinitionPage--;
    const slider = tooltip.querySelector('.definition-slider');
    updateSlider(slider, tooltip.querySelector('.definition-info'), tooltip.querySelector('.definition-prev'), tooltip.querySelector('.definition-next'), currentDefinitionPage, definitionPages.length, 'definition');
  });
  tooltip.querySelector('.definition-next').addEventListener('click', () => {
    if (currentDefinitionPage >= definitionPages.length - 1) return;
    currentDefinitionPage++;
    const slider = tooltip.querySelector('.definition-slider');
    updateSlider(slider, tooltip.querySelector('.definition-info'), tooltip.querySelector('.definition-prev'), tooltip.querySelector('.definition-next'), currentDefinitionPage, definitionPages.length, 'definition');
  });

  tooltip.querySelector('.translation-prev').addEventListener('click', () => {
    if (currentTranslationPage <= 0) return;
    currentTranslationPage--;
    const slider = tooltip.querySelector('.translation-slider');
    updateSlider(slider, tooltip.querySelector('.translation-info'), tooltip.querySelector('.translation-prev'), tooltip.querySelector('.translation-next'), currentTranslationPage, translationPages.length, 'translation');
  });
  tooltip.querySelector('.translation-next').addEventListener('click', () => {
    if (currentTranslationPage >= translationPages.length - 1) return;
    currentTranslationPage++;
    const slider = tooltip.querySelector('.translation-slider');
    updateSlider(slider, tooltip.querySelector('.translation-info'), tooltip.querySelector('.translation-prev'), tooltip.querySelector('.translation-next'), currentTranslationPage, translationPages.length, 'translation');
  });

  // Note: positionTooltipNearRect is already defined above with comfortable bounds; remove duplicate

  function showTooltipUI() {
    tooltip.style.display = 'block';
    requestAnimationFrame(() => tooltip.classList.add('show'));
  }

  // --------------------------- Trigger click -> fetch & render ---------------------------
  triggerIcon.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentSelection) return;
  
    // Cancel any active requests from previous selections
    cancelActiveRequests();
  
    tooltip.querySelector('.word-title').textContent = currentSelection.slice(0, 50);
    updateTranslationTitle();
  
    // initial loading states
    const defSlider = tooltip.querySelector('.definition-slider');
    const trSlider = tooltip.querySelector('.translation-slider');
  
    if (defSlider) {
      defSlider.textContent = ''; // clear
      const defPage = document.createElement('div');
      defPage.className = 'content-page';
      const defContent = document.createElement('div');
      defContent.className = 'definition-content loading';
      defContent.textContent = 'Loading...';
      defPage.appendChild(defContent);
      defSlider.appendChild(defPage);
    }
  
    if (trSlider) {
      trSlider.textContent = ''; // clear
      const trPage = document.createElement('div');
      trPage.className = 'content-page';
      const trContent = document.createElement('div');
      trContent.className = 'translation-content loading';
      trContent.textContent = 'Loading...';
      trPage.appendChild(trContent);
      trSlider.appendChild(trPage);
    }
    
    // Clear synonyms and antonyms immediately to prevent showing stale data
    renderSynAnt([], []);
  
    positionTooltipNearRect(selectionRect);
    showTooltipUI();
  
    // set initial loading heights to prevent jump
    const defCont = tooltip.querySelector('.definition-section .content-container');
    const transCont = tooltip.querySelector('.translation-section .content-container');
    if (defCont) smoothHeightTransition(defCont, 60, true);
    if (transCont) smoothHeightTransition(transCont, 80, true);
  
    try {
      // Check if source language is English for definitions
      if (sourceLanguage !== 'en' && sourceLanguage !== 'auto') {
        // Show message that definitions are only available for English
        if (defSlider) {
          defSlider.textContent = ''; // clear
          const defPage = document.createElement('div');
          defPage.className = 'content-page';
          const defContent = document.createElement('div');
          defContent.className = 'definition-content info';
          defContent.textContent = 'Definitions are only available for English words. Please select English as the source language.';
          defPage.appendChild(defContent);
          defSlider.appendChild(defPage);
        }
        renderSynAnt([], []);
      } else {
        const def = await fetchDefinition(currentSelection);
        renderDefinitionPages(def.defs);
        renderSynAnt(def.synonyms, def.antonyms);
      }
    } catch (err) {
      if (defSlider) {
        defSlider.textContent = ''; // clear
        const defPage = document.createElement('div');
        defPage.className = 'content-page';
        const defContent = document.createElement('div');
        defContent.className = 'definition-content error';
        defContent.textContent = String(err.message || err);
        defPage.appendChild(defContent);
        defSlider.appendChild(defPage);
      }
      renderSynAnt([], []);
    }
  
    try {
      const tr = await fetchTranslation(currentSelection);
      renderTranslationPages(tr.translations);
      // learned count heuristic: increment once per show
      totalWordsLearned += 1;
      storage.set('wordglance-total-words-learned', totalWordsLearned);
      settings.querySelector('.usage-number').textContent = String(totalWordsLearned);
    } catch (err) {
      if (trSlider) {
        trSlider.textContent = ''; // clear
        const trPage = document.createElement('div');
        trPage.className = 'content-page';
        const trContent = document.createElement('div');
        trContent.className = 'translation-content error';
        trContent.textContent = String(err.message || err);
        trPage.appendChild(trContent);
        trSlider.appendChild(trPage);
      }
    }
  });
  
  // prevent clicks from closing selection
  tooltip.addEventListener('mousedown', e => e.stopPropagation());
  tooltip.addEventListener('click', e => e.stopPropagation());
  triggerIcon.addEventListener('mousedown', e => e.stopPropagation());

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideTooltip(); hideTrigger(true); } });

  // --------------------------- Settings interactions ---------------------------
  function openSettings() {
    // center in viewport
    const rect = { w: window.innerWidth, h: window.innerHeight };
    settings.style.left = `${(rect.w - 380) / 2}px`;
    settings.style.top = `${(rect.h - 300) / 2}px`;
    settings.style.display = 'block';
  }
  function closeSettings() { settings.style.display = 'none'; }
  settings.querySelector('.close-button').addEventListener('click', closeSettings);

  // dark mode
  settings.querySelector('#dark-mode-toggle').addEventListener('change', async (e) => {
    isDarkMode = !!e.target.checked;
    await storage.set('wordglance-dark-mode', isDarkMode);
    applyDarkMode();
  });

  function setupLangSelector(prefix, isSource) {
    const selector = settings.querySelector(`#${prefix}-language-selector`);
    const dropdown = settings.querySelector(`#${prefix}-language-dropdown`);
    const search = settings.querySelector(`#${prefix}-language-search`);
    const options = settings.querySelector(`#${prefix}-language-options`);
    const label = selector.querySelector('.language-text');

    function filter() {
      const q = search.value.toLowerCase();
      Array.from(options.children).forEach(opt => {
        const t = opt.textContent.toLowerCase();
        const c = opt.dataset.code.toLowerCase();
        opt.style.display = (t.includes(q) || c.includes(q)) ? '' : 'none';
      });
    }

    selector.addEventListener('click', (e) => {
      // Don't toggle if clicking on the dropdown itself
      if (!dropdown.contains(e.target)) {
        e.stopPropagation();
        
        // Close other dropdown first
        const otherPrefix = prefix === 'source' ? 'target' : 'source';
        const otherDropdown = settings.querySelector(`#${otherPrefix}-language-dropdown`);
        if (otherDropdown) {
          otherDropdown.classList.remove('open');
          const otherSearch = settings.querySelector(`#${otherPrefix}-language-search`);
          if (otherSearch) {
            otherSearch.value = '';
            const otherOptions = settings.querySelector(`#${otherPrefix}-language-options`);
            if (otherOptions) {
              Array.from(otherOptions.children).forEach(opt => opt.style.display = '');
            }
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

    search.addEventListener('input', filter);

    // Handle Escape key in search
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.classList.remove('open');
        search.value = '';
        Array.from(options.children).forEach(opt => opt.style.display = '');
      }
    });

    options.addEventListener('click', async (e) => {
      const opt = e.target.closest('.language-option');
      if (!opt) return;
      
      const newCode = opt.dataset.code;
      const currentCode = isSource ? sourceLanguage : targetLanguage;
      
      if (newCode !== currentCode) {
        options.querySelectorAll('.language-option.selected').forEach(n => n.classList.remove('selected'));
        opt.classList.add('selected');
        
        if (isSource) {
          sourceLanguage = newCode; 
          await storage.set('wordglance-source-language', sourceLanguage);
        } else {
          targetLanguage = newCode; 
          await storage.set('wordglance-target-language', targetLanguage);
          // clear translation cache on target change
          caches.translations.clear(); 
          saveCaches();
        }
        
        label.textContent = getLanguageName(newCode);
        updateTranslationTitle();
      }
      
      // Clear search and close dropdown
      dropdown.classList.remove('open');
      search.value = '';
      Array.from(options.children).forEach(opt => opt.style.display = '');
    });

    // close on outside click but don't interfere with other dropdowns
    document.addEventListener('click', (e) => {
      if (!selector.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        search.value = '';
        Array.from(options.children).forEach(opt => opt.style.display = '');
      }
    });
  }
  setupLangSelector('source', true);
  setupLangSelector('target', false);

  // clear cache
  settings.querySelector('#clear-cache-btn').addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to clear all cached data and reset word counter?\n\nThis will delete:\n• All cached definitions and translations\n• Words learned counter\n\nThis action cannot be undone.');
    if (!confirmed) return;
    caches.definitions.clear(); caches.translations.clear(); saveCaches();
    totalWordsLearned = 0; await storage.set('wordglance-total-words-learned', totalWordsLearned);
    settings.querySelector('.usage-number').textContent = '0';
    updateCacheInfo();
  });

  // open settings on message or command
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'WORDGLANCE_OPEN_SETTINGS') openSettings();
  });

  // --------------------------- Utilities ---------------------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"]|'/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
  }

  // Initial console
  console.log('WordGlance extension loaded. Select text and click the 📖 icon.');
  console.log(`WordGlance v2.1.0 initialized with:
  - ${Object.keys(LANGUAGES).length} supported languages
  - ${CONFIG.cacheSize} item cache per type
  - Fast API response optimizations`);

  // pointer-events management: only the controls should receive events
  [tooltip, settings, triggerIcon].forEach(el => el.style.pointerEvents = 'auto');

  // Shadow root: clicking outside settings closes it
  shadow.addEventListener('click', (e) => {
    if (e.target === shadow) closeSettings();
  });

  // Show button upon selection; hide when user clicks outside shadow content
  document.addEventListener('click', (e) => {
    const path = e.composedPath();
    // clicks inside shadow UI
    if (path.includes(tooltip) || path.includes(triggerIcon) || path.includes(settings)) return;
    // outside -> hide tooltip; keep trigger only if selection still exists
    hideTooltip();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideTrigger();
  }, true);

})();

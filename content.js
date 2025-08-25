(() => {
  'use strict';

  // Constants
  const STORAGE_KEYS = {
    TARGET_LANGUAGE: 'wordglance-target-language',
    SOURCE_LANGUAGE: 'wordglance-source-language',
    CACHE_DEFINITIONS: 'wordglance-cache-definitions',
    CACHE_TRANSLATIONS: 'wordglance-cache-translations'
  };

  const CONFIG = {
    tooltipZIndex: 999999,
    maxDefinitions: 9,
    maxTranslations: 8,
    definitionsPerPage: 3,
    translationsPerPage: 4,
    maxSynonyms: 6,
    maxAntonyms: 6,
    cacheSize: 500,
    apiTimeout: 5000,
    debounceDelay: 100
  };

  const ERROR_MESSAGES = {
    NO_DEFINITION: 'Definition not found',
    NETWORK_ERROR: 'Connection error - please try again'
  };

  // State
  let targetLanguage = 'en';
  let sourceLanguage = 'auto';
  let currentSelection = '';
  let selectionRect = null;
  let currentDefinitionPage = 0;
  let currentTranslationPage = 0;
  let definitionPages = [];
  let translationPages = [];
  let definitionPageHeights = [];
  let translationPageHeights = [];

  const caches = {
    definitions: new Map(),
    translations: new Map()
  };
  let activeRequests = new Set();

  // Utilities
  function lruAdd(map, key, value) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > CONFIG.cacheSize) {
      map.delete(map.keys().next().value);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    let s = text.trim().replace(/[\x00-\x1F\x7F-\x9F<>'"&]/g, '');
    if (s.length === 0 || s.length > 100) return '';
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 5 || /^\d+$/.test(s)) return '';
    if (!/^[\w\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u200c\u200d\s\-\'\.\,\;\:\!\?]+$/.test(s)) return '';
    if (!/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(s)) return '';
    return s;
  }

  // Shadow DOM setup
  const host = document.createElement('div');
  host.setAttribute('data-wordglance', '');
  Object.assign(host.style, {
    position: 'fixed', top: '0', left: '0', width: '0', height: '0',
    zIndex: String(CONFIG.tooltipZIndex), pointerEvents: 'none'
  });
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .wordglance-tooltip {
      position: absolute; background: #ffffff; border: 1px solid #e0e0e0;
      border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 16px; max-width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; line-height: 1.5; display: none; pointer-events: auto;
      transition: opacity 0.3s ease, transform 0.3s ease; word-wrap: break-word;
      overflow-wrap: break-word; opacity: 0; transform: translateY(-10px) scale(0.95);
      will-change: transform, opacity; color: #2c3e50; contain: layout style paint;
    }
    .wordglance-tooltip.show { opacity: 1; transform: translateY(0) scale(1); }
    .wordglance-tooltip.dark-mode { 
      background: #1a1a1a; border-color: #333333; color: #e0e0e0; 
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); 
    }
    
    .wordglance-trigger-icon {
      position: absolute; background: #3498db; color: white; border: none;
      border-radius: 50%; width: 24px; height: 24px; font-size: 12px;
      cursor: pointer; display: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: transform 0.25s ease, background-color 0.25s ease; font-weight: bold;
      opacity: 0; transform: scale(0.8); will-change: transform, opacity;
      pointer-events: auto; z-index: 999999;
    }
    @media (hover: none) and (pointer: coarse) {
      .wordglance-trigger-icon { width: 32px; height: 32px; font-size: 16px; }
    }
    .wordglance-trigger-icon.show { opacity: 1; transform: scale(1); }
    .wordglance-trigger-icon:hover { background: #2980b9; transform: scale(1.1); }
    .wordglance-trigger-icon.dark-mode { background: #ff6b6b; }
    .wordglance-trigger-icon.dark-mode:hover { background: #ff5252; }

    .wordglance-tooltip .definition-section { margin-bottom: 16px; }
    .wordglance-tooltip .translation-section { margin-bottom: 0; }
    
    .wordglance-tooltip .section-title {
      font-weight: 600; color: #2c3e50; margin-bottom: 8px; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.5px; display: flex;
      justify-content: space-between; align-items: center;
    }
    .wordglance-tooltip.dark-mode .section-title { color: #cccccc; }
    
    .wordglance-tooltip .slider-controls { display: flex; gap: 4px; align-items: center; }
    .wordglance-tooltip .slider-button {
      background: none; border: none; border-radius: 3px; width: 20px; height: 20px;
      font-size: 12px; cursor: pointer; color: #7f8c8d; display: flex;
      align-items: center; justify-content: center; transition: color 0.2s;
    }
    .wordglance-tooltip .slider-button:hover { color: #2c3e50; }
    .wordglance-tooltip .slider-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wordglance-tooltip.dark-mode .slider-button { color: #cccccc; }
    .wordglance-tooltip.dark-mode .slider-button:hover:not(:disabled) { color: #ffffff; }
    .wordglance-tooltip .slider-info { 
      font-size: 11px; color: #7f8c8d; margin: 0 4px; white-space: nowrap; 
    }
    
    .wordglance-tooltip .content-container {
      position: relative; overflow: hidden; height: auto;
      transition: height 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94); will-change: height;
    }
    .wordglance-tooltip .content-slider {
      display: flex; transition: transform 0.3s ease; width: 100%; height: auto; will-change: transform;
    }
    .wordglance-tooltip .content-page {
      min-width: 100%; max-width: 100%; flex-shrink: 0; word-wrap: break-word;
      overflow-wrap: break-word; box-sizing: border-box; height: auto;
    }
    
    .wordglance-tooltip .definition-item {
      margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #f8f9fa;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    .wordglance-tooltip.dark-mode .definition-item { border-bottom-color: #333333; }
    .wordglance-tooltip .definition-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    
    .wordglance-tooltip .part-of-speech { 
      color: #7f8c8d; font-style: italic; font-size: 12px; margin-right: 8px; 
    }
    .wordglance-tooltip.dark-mode .part-of-speech { color: #cccccc; }
    .wordglance-tooltip .definition-text {
      color: #2c3e50; margin-bottom: 4px; word-wrap: break-word; overflow-wrap: break-word;
    }
    .wordglance-tooltip.dark-mode .definition-text { color: #e0e0e0; }
    
    .wordglance-tooltip .translation-item { margin-bottom: 4px; word-wrap: break-word; overflow-wrap: break-word; }
    .wordglance-tooltip .translation-grid {
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
      min-height: 80px; position: relative; border-radius: 4px; overflow: hidden;
    }
    .wordglance-tooltip .translation-grid::before {
      content: ''; position: absolute; top: 50%; left: 10%; right: 10%; height: 2px;
      background: #e0e0e0; transform: translateY(-1px); z-index: 3;
    }
    .wordglance-tooltip .translation-grid::after {
      content: ''; position: absolute; top: 5%; bottom: 5%; left: 50%; width: 2px;
      background: #e0e0e0; transform: translateX(-1px); z-index: 3;
    }
    .wordglance-tooltip.dark-mode .translation-grid::before,
    .wordglance-tooltip.dark-mode .translation-grid::after { background: #333333; }
    .wordglance-tooltip .translation-text {
      color: #27ae60; font-weight: 500; font-size: 14px; word-wrap: break-word;
      overflow-wrap: break-word; padding: 12px 8px; display: flex;
      align-items: center; justify-content: center; text-align: center;
      min-height: 20px; background: #ffffff; position: relative; z-index: 2;
    }
    .wordglance-tooltip.dark-mode .translation-text { color: #4fc3f7; background: #1a1a1a; }
    
    .wordglance-tooltip .example { font-style: italic; color: #7f8c8d; font-size: 12px; margin-top: 4px; }
    .wordglance-tooltip.dark-mode .example { color: #cccccc; }
    .wordglance-tooltip .loading { color: #7f8c8d; font-style: italic; }
    .wordglance-tooltip.dark-mode .loading { color: #cccccc; }
    .wordglance-tooltip .error { color: #e74c3c; font-size: 13px; }
    .wordglance-tooltip.dark-mode .error { color: #ff6b6b; }
    .wordglance-tooltip .info { 
      color: rgb(0, 60, 170); font-size: 14px; font-weight: 600; text-align: center; 
      padding: 20px 16px; line-height: 1.4; font-style: italic;
    }
    .wordglance-tooltip.dark-mode .info { color: rgb(172, 219, 52); }
    
    .wordglance-tooltip .synonyms-antonyms-section { margin-top: 12px; }
    .wordglance-tooltip .synonyms, .wordglance-tooltip .antonyms { margin-top: 4px; }
    .wordglance-tooltip .synonyms-label, .wordglance-tooltip .antonyms-label { 
      font-weight: 600; color: #2c3e50; 
    }
    .wordglance-tooltip.dark-mode .synonyms-label, .wordglance-tooltip.dark-mode .antonyms-label { 
      color: #cccccc; 
    }
    .wordglance-tooltip .synonyms-list, .wordglance-tooltip .antonyms-list { 
      color: #7f8c8d; font-style: italic; 
    }
    .wordglance-tooltip.dark-mode .synonyms-list, .wordglance-tooltip.dark-mode .antonyms-list { 
      color: #cccccc; 
    }
  `;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'wordglance-root';
  Object.assign(root.style, {
    position: 'fixed', pointerEvents: 'none', top: '0', left: '0',
    width: '100vw', height: '100vh'
  });
  shadow.appendChild(root);

  // Create UI elements
  const triggerIcon = document.createElement('button');
  triggerIcon.className = 'wordglance-trigger-icon';
  triggerIcon.textContent = '📖';
  triggerIcon.setAttribute('aria-label', 'Look up word definition and translation');
  triggerIcon.style.display = 'none';
  root.appendChild(triggerIcon);

  const tooltip = document.createElement('div');
  tooltip.className = 'wordglance-tooltip';
  tooltip.style.display = 'none';
  root.appendChild(tooltip);

  // Build tooltip structure
  function createElement(tag, className, textContent = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
  }

  function buildTooltipStructure() {
    // Definition section
    const defSection = createElement('div', 'definition-section');
    const defTitle = createElement('div', 'section-title');
    const wordTitle = createElement('span', 'word-title', 'Word');
    defTitle.appendChild(wordTitle);

    const defControls = createElement('div', 'slider-controls');
    const defPrev = createElement('button', 'slider-button definition-prev', '‹');
    const defInfo = createElement('span', 'slider-info definition-info', '1/1');
    const defNext = createElement('button', 'slider-button definition-next', '›');
    defControls.append(defPrev, defInfo, defNext);
    defTitle.appendChild(defControls);
    defSection.appendChild(defTitle);

    const defContainer = createElement('div', 'content-container');
    const defSlider = createElement('div', 'content-slider definition-slider');
    defContainer.appendChild(defSlider);
    defSection.appendChild(defContainer);

    // Translation section
    const transSection = createElement('div', 'translation-section');
    const transTitle = createElement('div', 'section-title');
    const transSpan = createElement('span', 'translation-title', 'Loading...');
    transTitle.appendChild(transSpan);

    const transControls = createElement('div', 'slider-controls');
    const transPrev = createElement('button', 'slider-button translation-prev', '‹');
    const transInfo = createElement('span', 'slider-info translation-info', '1/1');
    const transNext = createElement('button', 'slider-button translation-next', '›');
    transControls.append(transPrev, transInfo, transNext);
    transTitle.appendChild(transControls);
    transSection.appendChild(transTitle);

    const transContainer = createElement('div', 'content-container');
    const transSlider = createElement('div', 'content-slider translation-slider');
    transContainer.appendChild(transSlider);
    transSection.appendChild(transContainer);

    // Synonyms & Antonyms section
    const synSection = createElement('div', 'synonyms-antonyms-section');
    synSection.style.display = 'none';
    const synContent = createElement('div', 'synonyms-antonyms-content');
    synSection.appendChild(synContent);

    tooltip.append(defSection, transSection, synSection);
  }

  buildTooltipStructure();

  // Settings initialization and management
  async function loadSettings() {
    try {
      const settings = await browser.storage.local.get([
        STORAGE_KEYS.TARGET_LANGUAGE,
        STORAGE_KEYS.SOURCE_LANGUAGE
      ]);
      
      targetLanguage = settings[STORAGE_KEYS.TARGET_LANGUAGE] || 'en';
      sourceLanguage = settings[STORAGE_KEYS.SOURCE_LANGUAGE] || 'auto';
      updateTranslationTitle();
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  async function loadCaches() {
    try {
      const [defCache, transCache] = await Promise.all([
        browser.storage.local.get(STORAGE_KEYS.CACHE_DEFINITIONS),
        browser.storage.local.get(STORAGE_KEYS.CACHE_TRANSLATIONS)
      ]);
      
      if (defCache[STORAGE_KEYS.CACHE_DEFINITIONS]) {
        const defs = JSON.parse(defCache[STORAGE_KEYS.CACHE_DEFINITIONS]);
        Object.entries(defs).forEach(([k, v]) => lruAdd(caches.definitions, k, v));
      }
      
      if (transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]) {
        const trans = JSON.parse(transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]);
        Object.entries(trans).forEach(([k, v]) => lruAdd(caches.translations, k, v));
      }
    } catch (e) {
      console.warn('Cache loading error:', e);
    }
  }

  // Listen for storage changes from popup
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    if (changes[STORAGE_KEYS.TARGET_LANGUAGE]) {
      targetLanguage = changes[STORAGE_KEYS.TARGET_LANGUAGE].newValue || 'en';
      updateTranslationTitle();
    }
    
    if (changes[STORAGE_KEYS.SOURCE_LANGUAGE]) {
      sourceLanguage = changes[STORAGE_KEYS.SOURCE_LANGUAGE].newValue || 'auto';
      updateTranslationTitle();
    }
  });

  // Initialize
  loadSettings();
  loadCaches();

  // Selection handling
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
    } catch (e) {
      console.warn('Selection range error:', e);
      return null;
    }
  }

  function positionTriggerIcon(x, y) {
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
    
    Object.assign(triggerIcon.style, { left: `${left}px`, top: `${top}px` });
  }

  function showTrigger() {
    triggerIcon.style.display = 'block';
    requestAnimationFrame(() => triggerIcon.classList.add('show'));
  }

  function hideTrigger() {
    triggerIcon.classList.remove('show');
    setTimeout(() => {
      if (!triggerIcon.classList.contains('show')) triggerIcon.style.display = 'none';
    }, 250);
  }

  function hideTooltip() {
    tooltip.classList.remove('show');
    setTimeout(() => {
      tooltip.style.display = 'none';
      clearTooltipContent();
    }, 200);
  }

  function clearTooltipContent() {
    ['definition-slider', 'translation-slider'].forEach(selector => {
      const slider = tooltip.querySelector(`.${selector}`);
      if (slider) slider.textContent = '';
    });
    
    renderSynAnt([], []);
    currentDefinitionPage = currentTranslationPage = 0;
    definitionPageHeights = translationPageHeights = [];
  }

  function onSelectionEvent() {
    const info = getSelectionInfo();
    if (!info) {
      hideTrigger();
      return;
    }
    
    currentSelection = info.text;
    selectionRect = info.rect;
    const cx = selectionRect.left + (selectionRect.width / 2);
    const cy = selectionRect.top;
    positionTriggerIcon(cx, cy);
    showTrigger();
  }

  const debouncedSelectionHandler = debounce(onSelectionEvent, CONFIG.debounceDelay);

  // Event listeners
  document.addEventListener('mouseup', onSelectionEvent, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
      hideTooltip();
      hideTrigger();
      return;
    }
    debouncedSelectionHandler();
  }, true);
  document.addEventListener('touchend', () => setTimeout(debouncedSelectionHandler, 100), { passive: true });
  document.addEventListener('selectionchange', () => {
    if (document.hasFocus()) setTimeout(debouncedSelectionHandler, 150);
  });

  const updateSelectionRect = () => {
    if (selectionRect) {
      const info = getSelectionInfo();
      if (info) {
        selectionRect = info.rect;
        const cx = selectionRect.left + selectionRect.width / 2;
        const cy = selectionRect.top;
        positionTriggerIcon(cx, cy);
        showTrigger();
      }
    }
  };

  window.addEventListener('scroll', updateSelectionRect, { passive: true });
  window.addEventListener('resize', updateSelectionRect);

  // API helpers
  async function xfetch(url, init = {}) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), CONFIG.apiTimeout);
    
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      clearTimeout(timeout);
      const resp = await browser.runtime.sendMessage({ type: 'WORDGLANCE_FETCH', url, init });
      if (!resp) throw new Error('No response from background script');
      
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        text: async () => resp.text,
        json: async () => JSON.parse(resp.text)
      };
    }
  }

  function saveCaches() {
    try {
      const defObj = Object.fromEntries(caches.definitions);
      const transObj = Object.fromEntries(caches.translations);
      
      browser.storage.local.set({
        [STORAGE_KEYS.CACHE_DEFINITIONS]: JSON.stringify(defObj),
        [STORAGE_KEYS.CACHE_TRANSLATIONS]: JSON.stringify(transObj)
      });
    } catch (e) {
      console.warn('Cache save error:', e);
    }
  }

  async function fetchDefinition(word) {
    const key = word.toLowerCase();
    if (caches.definitions.has(key)) return caches.definitions.get(key);
    
    const requestId = `def-${word}-${Date.now()}`;
    activeRequests.add(requestId);
    
    try {
      const res = await xfetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
      
      if (!activeRequests.has(requestId)) return;
      activeRequests.delete(requestId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const defs = [], syns = new Set(), ants = new Set();
      (data || []).forEach(entry => {
        (entry.meanings || []).forEach(m => {
          (m.synonyms || []).forEach(s => syns.add(s));
          (m.antonyms || []).forEach(a => ants.add(a));
          
          (m.definitions || []).forEach(d => {
            if (d.definition) {
              defs.push({
                definition: d.definition,
                partOfSpeech: m.partOfSpeech || '',
                example: d.example || ''
              });
            }
            (d.synonyms || []).forEach(s => syns.add(s));
            (d.antonyms || []).forEach(a => ants.add(a));
          });
        });
      });
      
      const result = {
        defs: defs.slice(0, CONFIG.maxDefinitions),
        synonyms: Array.from(syns).slice(0, CONFIG.maxSynonyms),
        antonyms: Array.from(ants).slice(0, CONFIG.maxAntonyms)
      };
      
      lruAdd(caches.definitions, key, result);
      saveCaches();
      return result;
    } catch (e) {
      activeRequests.delete(requestId);
      throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
    }
  }

  async function fetchTranslation(text) {
    const key = `${text}::${sourceLanguage}::${targetLanguage}`;
    if (caches.translations.has(key)) return caches.translations.get(key);
    
    const requestId = `trans-${text}-${sourceLanguage}-${targetLanguage}-${Date.now()}`;
    activeRequests.add(requestId);
    
    const params = new URLSearchParams({ dl: targetLanguage, text });
    if (sourceLanguage !== 'auto') params.set('sl', sourceLanguage);
    
    try {
      const res = await xfetch(`https://ftapi.pythonanywhere.com/translate?${params}`);
      
      if (!activeRequests.has(requestId)) return;
      activeRequests.delete(requestId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const translations = [];
      if (data?.['destination-text']) {
        translations.push(data['destination-text']);
        
        const allTranslations = data.translations?.['all-translations'] || [];
        for (const group of allTranslations) {
          if (Array.isArray(group) && group[0] && group[0] !== data['destination-text'] && !translations.includes(group[0])) {
            translations.push(group[0]);
            if (translations.length >= CONFIG.maxTranslations) break;
          }
        }
        
        if (translations.length < CONFIG.maxTranslations) {
          const extra = (data.translations?.['possible-translations'] || [])
            .filter(t => t && !translations.includes(t));
          translations.push(...extra.slice(0, CONFIG.maxTranslations - translations.length));
        }
      }
      
      const result = { translations: translations.slice(0, CONFIG.maxTranslations) };
      lruAdd(caches.translations, key, result);
      saveCaches();
      return result;
    } catch (e) {
      activeRequests.delete(requestId);
      throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
    }
  }

  // Rendering functions
  function paginate(array, perPage) {
    const pages = [];
    for (let i = 0; i < array.length; i += perPage) {
      pages.push(array.slice(i, i + perPage));
    }
    return pages.length ? pages : [[]];
  }

  function updateTranslationTitle() {
    const titleEl = tooltip.querySelector('.translation-title');
    if (titleEl) {
      const sourceName = sourceLanguage === 'auto' ? 'Auto' : sourceLanguage.toUpperCase();
      const targetName = targetLanguage.toUpperCase();
      titleEl.textContent = `${sourceName} → ${targetName}`;
    }
  }

  function measurePageHeight(page) {
    const prevStyle = page.getAttribute('style') || '';
    Object.assign(page.style, {
      position: 'absolute', visibility: 'hidden', left: '-10000px',
      top: '0', height: 'auto'
    });
    const height = page.scrollHeight;
    page.setAttribute('style', prevStyle);
    return height;
  }

  function smoothHeightTransition(container, targetHeight, immediate = false) {
    if (!container) return;
    if (immediate) {
      const prev = container.style.transition;
      container.style.transition = 'none';
      container.style.height = targetHeight + 'px';
      requestAnimationFrame(() => {
        container.style.transition = prev || 'height 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
      });
    } else {
      container.style.height = targetHeight + 'px';
    }
  }

  function updateSlider(slider, info, prev, next, index, total, kind) {
    slider.style.transform = `translateX(-${index * 100}%)`;
    info.textContent = `${Math.min(index + 1, total)}/${total || 1}`;
    prev.disabled = index <= 0;
    next.disabled = index >= total - 1;
    
    if (kind) {
      const container = slider.closest('.content-container');
      const heights = kind === 'definition' ? definitionPageHeights : translationPageHeights;
      const target = heights[index] || (slider.children[index]?.scrollHeight || 0);
      if (container && target) smoothHeightTransition(container, target);
    }
  }

  function createContentPage(content, isError = false) {
    const pageDiv = createElement('div', 'content-page');
    const contentDiv = createElement('div', isError ? 'error' : 'loading');
    contentDiv.textContent = content;
    pageDiv.appendChild(contentDiv);
    return pageDiv;
  }

  function renderDefinitionPages(defs) {
    const slider = tooltip.querySelector('.definition-slider');
    const info = tooltip.querySelector('.definition-info');
    const prev = tooltip.querySelector('.definition-prev');
    const next = tooltip.querySelector('.definition-next');
    
    definitionPages = paginate(defs.slice(0, CONFIG.maxDefinitions), CONFIG.definitionsPerPage);
    currentDefinitionPage = 0;
    slider.textContent = '';
    
    definitionPages.forEach(page => {
      const pageDiv = createElement('div', 'content-page');
      
      if (!page.length) {
        pageDiv.appendChild(createElement('div', 'definition-content error', ERROR_MESSAGES.NO_DEFINITION));
      } else {
        page.forEach(d => {
          const defDiv = createElement('div', 'definition-item');
          
          if (d.partOfSpeech) {
            defDiv.appendChild(createElement('span', 'part-of-speech', d.partOfSpeech));
          }
          
          defDiv.appendChild(createElement('div', 'definition-text', d.definition));
          
          if (d.example) {
            defDiv.appendChild(createElement('div', 'example', d.example));
          }
          
          pageDiv.appendChild(defDiv);
        });
      }
      
      slider.appendChild(pageDiv);
    });
    
    definitionPageHeights = Array.from(slider.children).map(measurePageHeight);
    updateSlider(slider, info, prev, next, currentDefinitionPage, definitionPages.length, 'definition');
    attachSliderHeightSync('definition');
  }

  function renderTranslationPages(items) {
    const slider = tooltip.querySelector('.translation-slider');
    const info = tooltip.querySelector('.translation-info');
    const prev = tooltip.querySelector('.translation-prev');
    const next = tooltip.querySelector('.translation-next');
    
    translationPages = paginate(items.slice(0, CONFIG.maxTranslations), CONFIG.translationsPerPage);
    currentTranslationPage = 0;
    slider.textContent = '';
    
    translationPages.forEach(page => {
      const pageDiv = createElement('div', 'content-page');
      const grid = createElement('div', 'translation-grid');
      
      for (let i = 0; i < 4; i++) {
        const cell = createElement('div', 'translation-text', page[i] || '');
        grid.appendChild(cell);
      }
      
      pageDiv.appendChild(grid);
      slider.appendChild(pageDiv);
    });
    
    translationPageHeights = Array.from(slider.children).map(measurePageHeight);
    updateSlider(slider, info, prev, next, currentTranslationPage, translationPages.length, 'translation');
    attachSliderHeightSync('translation');
  }

  function renderSynAnt(synonyms, antonyms) {
    const section = tooltip.querySelector('.synonyms-antonyms-section');
    const container = tooltip.querySelector('.synonyms-antonyms-content');
    if (!section || !container) return;

    container.textContent = '';
    let hasContent = false;

    if (synonyms?.length) {
      const synDiv = createElement('div', 'synonyms');
      synDiv.appendChild(createElement('span', 'synonyms-label', 'Synonyms: '));
      synDiv.appendChild(createElement('span', 'synonyms-list', synonyms.slice(0, CONFIG.maxSynonyms).join(', ')));
      container.appendChild(synDiv);
      hasContent = true;
    }

    if (antonyms?.length) {
      const antDiv = createElement('div', 'antonyms');
      antDiv.appendChild(createElement('span', 'antonyms-label', 'Antonyms: '));
      antDiv.appendChild(createElement('span', 'antonyms-list', antonyms.slice(0, CONFIG.maxAntonyms).join(', ')));
      container.appendChild(antDiv);
      hasContent = true;
    }

    section.style.display = hasContent ? '' : 'none';
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
    
    if (slider._heightHandler) slider.removeEventListener('transitionend', slider._heightHandler);
    slider.addEventListener('transitionend', handler);
    slider._heightHandler = handler;
  }

  function positionTooltipNearRect(rect) {
    const margin = 20;
    const tRect = tooltip.getBoundingClientRect();
    let left = rect.left + 10;
    let top = rect.top - (tRect.height || 120) - 10;
    const vw = window.innerWidth, vh = window.innerHeight;
    
    if (left + (tRect.width || 320) > vw - margin) left = rect.right - (tRect.width || 320) - 10;
    if (top < margin) top = rect.bottom + 20;
    
    left = Math.max(margin, Math.min(left, vw - (tRect.width || 320) - margin));
    top = Math.max(margin, Math.min(top, vh - 180 - margin));
    
    Object.assign(tooltip.style, { left: `${left}px`, top: `${top}px` });
  }

  function showTooltipUI() {
    tooltip.style.display = 'block';
    requestAnimationFrame(() => tooltip.classList.add('show'));
  }

  // Slider navigation
  function setupSliderNavigation() {
    const sliders = [
      { prev: '.definition-prev', next: '.definition-next', type: 'definition' },
      { prev: '.translation-prev', next: '.translation-next', type: 'translation' }
    ];

    sliders.forEach(({ prev, next, type }) => {
      tooltip.querySelector(prev).addEventListener('click', () => {
        const currentPage = type === 'definition' ? currentDefinitionPage : currentTranslationPage;
        const pages = type === 'definition' ? definitionPages : translationPages;
        
        if (currentPage <= 0) return;
        
        if (type === 'definition') currentDefinitionPage--;
        else currentTranslationPage--;
        
        const slider = tooltip.querySelector(`.${type}-slider`);
        const info = tooltip.querySelector(`.${type}-info`);
        const prevBtn = tooltip.querySelector(prev);
        const nextBtn = tooltip.querySelector(next);
        
        updateSlider(slider, info, prevBtn, nextBtn, 
          type === 'definition' ? currentDefinitionPage : currentTranslationPage, 
          pages.length, type);
      });

      tooltip.querySelector(next).addEventListener('click', () => {
        const currentPage = type === 'definition' ? currentDefinitionPage : currentTranslationPage;
        const pages = type === 'definition' ? definitionPages : translationPages;
        
        if (currentPage >= pages.length - 1) return;
        
        if (type === 'definition') currentDefinitionPage++;
        else currentTranslationPage++;
        
        const slider = tooltip.querySelector(`.${type}-slider`);
        const info = tooltip.querySelector(`.${type}-info`);
        const prevBtn = tooltip.querySelector(prev);
        const nextBtn = tooltip.querySelector(next);
        
        updateSlider(slider, info, prevBtn, nextBtn, 
          type === 'definition' ? currentDefinitionPage : currentTranslationPage, 
          pages.length, type);
      });
    });
  }

  setupSliderNavigation();

  // Main trigger click handler
  triggerIcon.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentSelection) return;

    activeRequests.clear();

    tooltip.querySelector('.word-title').textContent = currentSelection.slice(0, 50);
    updateTranslationTitle();

    const defSlider = tooltip.querySelector('.definition-slider');
    const transSlider = tooltip.querySelector('.translation-slider');

    // Set loading states
    [defSlider, transSlider].forEach(slider => {
      if (slider) {
        slider.textContent = '';
        slider.appendChild(createContentPage('Loading...'));
      }
    });

    renderSynAnt([], []);
    positionTooltipNearRect(selectionRect);
    showTooltipUI();

    // Set initial loading heights
    const defContainer = tooltip.querySelector('.definition-section .content-container');
    const transContainer = tooltip.querySelector('.translation-section .content-container');
    if (defContainer) smoothHeightTransition(defContainer, 60, true);
    if (transContainer) smoothHeightTransition(transContainer, 80, true);

    // Fetch definitions
    try {
      if (sourceLanguage !== 'en' && sourceLanguage !== 'auto') {
        defSlider.textContent = '';
        const infoPage = createElement('div', 'content-page');
        infoPage.appendChild(createElement('div', 'definition-content info', 
          'Definitions are only available for English words. Please select English as the source language.'));
        defSlider.appendChild(infoPage);
        renderSynAnt([], []);
      } else {
        const def = await fetchDefinition(currentSelection);
        renderDefinitionPages(def.defs);
        renderSynAnt(def.synonyms, def.antonyms);
      }
    } catch (err) {
      defSlider.textContent = '';
      defSlider.appendChild(createContentPage(err.message || err, true));
      renderSynAnt([], []);
    }

    // Fetch translations
    try {
      const trans = await fetchTranslation(currentSelection);
      renderTranslationPages(trans.translations);
    } catch (err) {
      transSlider.textContent = '';
      transSlider.appendChild(createContentPage(err.message || err, true));
    }
  });

  // Event delegation and cleanup
  [tooltip, triggerIcon].forEach(el => {
    el.addEventListener('mousedown', e => e.stopPropagation());
    el.addEventListener('click', e => e.stopPropagation());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideTooltip();
      hideTrigger();
    }
  });

  document.addEventListener('click', (e) => {
    const path = e.composedPath();
    if (path.includes(tooltip) || path.includes(triggerIcon)) return;
    
    hideTooltip();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideTrigger();
  }, true);

  console.log('WordGlance extension loaded. Select text and click the 📖 icon.');
  console.log(`WordGlance v2.3.0 (optimized) initialized with ${Object.keys(LANGUAGES).length} supported languages`);
})();
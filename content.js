(() => {
  'use strict';

  // Content-specific configuration
  const CONFIG = {
    tooltipZIndex: 999999,
    maxDefinitions: 9,
    maxTranslations: 8,
    definitionsPerPage: 3,
    translationsPerPage: 4,
    maxSynonyms: 6,
    maxAntonyms: 6,
    debounceDelay: 100
  };

  // State
  let currentSelection = '';
  let selectionRect = null;
  let currentDefinitionPage = 0;
  let currentTranslationPage = 0;
  let definitionPages = [];
  let translationPages = [];
  let definitionPageHeights = [];
  let translationPageHeights = [];
  let settings = {
    targetLanguage: DEFAULT_VALUES.TARGET_LANGUAGE,
    sourceLanguage: DEFAULT_VALUES.SOURCE_LANGUAGE,
    darkMode: DEFAULT_VALUES.DARK_MODE
  };

  // Utilities
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }



  // Settings management
  async function loadSettings() {
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
      if (response.success) {
        settings = { ...settings, ...response.data };
        updateTranslationTitle();
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  // Listen for storage changes from popup
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    if (changes[STORAGE_KEYS.TARGET_LANGUAGE]) {
      settings.targetLanguage = changes[STORAGE_KEYS.TARGET_LANGUAGE].newValue || DEFAULT_VALUES.TARGET_LANGUAGE;
      updateTranslationTitle();
    }
    
    if (changes[STORAGE_KEYS.SOURCE_LANGUAGE]) {
      settings.sourceLanguage = changes[STORAGE_KEYS.SOURCE_LANGUAGE].newValue || DEFAULT_VALUES.SOURCE_LANGUAGE;
      updateTranslationTitle();
    }
    
    if (changes[STORAGE_KEYS.DARK_MODE]) {
      settings.darkMode = changes[STORAGE_KEYS.DARK_MODE].newValue || DEFAULT_VALUES.DARK_MODE;
      updateDarkMode();
    }
  });

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
      z-index: 99999;
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
      pointer-events: auto; z-index: 9999;
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

  // Cache frequently used DOM selectors
  const cachedSelectors = {
    wordTitle: null,
    translationTitle: null,
    defSlider: null,
    transSlider: null,
    defContainer: null,
    transContainer: null
  };

  function getCachedSelector(key, selector) {
    if (!cachedSelectors[key]) {
      cachedSelectors[key] = tooltip.querySelector(selector);
    }
    return cachedSelectors[key];
  }

  function clearCachedSelectors() {
    Object.keys(cachedSelectors).forEach(key => {
      cachedSelectors[key] = null;
    });
  }

  // Dark mode management
  function updateDarkMode() {
    const methods = settings.darkMode ? 'add' : 'remove';
    tooltip.classList[methods]('dark-mode');
    triggerIcon.classList[methods]('dark-mode');
  }

  // Selection handling
  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    
    const text = sel.toString().trim();
    if (!text || text.length === 0 || text.length > 100) return null;
    
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
      ('ontouchstart' in window) || 
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      window.matchMedia('(pointer: coarse)').matches;
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
      cleanupEventListeners();
    }, 200);
  }

  function cleanupEventListeners() {
    // Clean up slider height sync handlers
    ['definition', 'translation'].forEach(kind => {
      const slider = tooltip.querySelector(`.${kind}-slider`);
      if (slider && slider._heightHandler) {
        slider.removeEventListener('transitionend', slider._heightHandler);
        slider._heightHandler = null;
      }
    });
  }

  function clearTooltipContent() {
    ['definition-slider', 'translation-slider'].forEach(selector => {
      const slider = tooltip.querySelector(`.${selector}`);
      if (slider) slider.textContent = '';
    });
    
    renderSynAnt([], []);
    currentDefinitionPage = currentTranslationPage = 0;
    definitionPageHeights = translationPageHeights = [];
    clearCachedSelectors();
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
        
        // Also reposition tooltip if it's visible
        repositionTooltip();
      }
    }
  };

  window.addEventListener('scroll', updateSelectionRect, { passive: true });
  window.addEventListener('resize', updateSelectionRect);

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
      const sourceName = settings.sourceLanguage === 'auto' ? 'Auto' : settings.sourceLanguage.toUpperCase();
      const targetName = settings.targetLanguage.toUpperCase();
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
      if (window.requestAnimationFrame) {
        requestAnimationFrame(() => {
          container.style.transition = prev || 'height 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
        });
      } else {
        setTimeout(() => {
          container.style.transition = prev || 'height 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
        }, 16);
      }
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
    const margin = 16;
    const spacing = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Get actual tooltip dimensions after content is rendered
    const tRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tRect.width || 320; // fallback for initial positioning
    const tooltipHeight = tRect.height || 200; // fallback for initial positioning
    
    // Define possible positions in order of preference
    const positions = [
      // Above (preferred)
      {
        name: 'above',
        left: rect.left + (rect.width / 2) - (tooltipWidth / 2),
        top: rect.top - tooltipHeight - spacing
      },
      // Below
      {
        name: 'below',
        left: rect.left + (rect.width / 2) - (tooltipWidth / 2),
        top: rect.bottom + spacing
      },
      // Right
      {
        name: 'right',
        left: rect.right + spacing,
        top: rect.top + (rect.height / 2) - (tooltipHeight / 2)
      },
      // Left
      {
        name: 'left',
        left: rect.left - tooltipWidth - spacing,
        top: rect.top + (rect.height / 2) - (tooltipHeight / 2)
      },
      // Above-right (if centered above doesn't fit)
      {
        name: 'above-right',
        left: rect.right - tooltipWidth,
        top: rect.top - tooltipHeight - spacing
      },
      // Above-left (if centered above doesn't fit)
      {
        name: 'above-left',
        left: rect.left,
        top: rect.top - tooltipHeight - spacing
      },
      // Below-right (if centered below doesn't fit)
      {
        name: 'below-right',
        left: rect.right - tooltipWidth,
        top: rect.bottom + spacing
      },
      // Below-left (if centered below doesn't fit)
      {
        name: 'below-left',
        left: rect.left,
        top: rect.bottom + spacing
      }
    ];
    
    // Function to check if a position fits within viewport
    function fitsInViewport(pos) {
      return pos.left >= margin && 
             pos.top >= margin && 
             pos.left + tooltipWidth <= vw - margin && 
             pos.top + tooltipHeight <= vh - margin;
    }
    
    // Find the first position that fits
    let bestPosition = null;
    for (const pos of positions) {
      if (fitsInViewport(pos)) {
        bestPosition = pos;
        break;
      }
    }
    
    // If no position fits perfectly, use the preferred position and adjust
    if (!bestPosition) {
      bestPosition = positions[0]; // Default to above
      
      // Adjust horizontally
      if (bestPosition.left < margin) {
        bestPosition.left = margin;
      } else if (bestPosition.left + tooltipWidth > vw - margin) {
        bestPosition.left = vw - tooltipWidth - margin;
      }
      
      // Adjust vertically
      if (bestPosition.top < margin) {
        bestPosition.top = margin;
      } else if (bestPosition.top + tooltipHeight > vh - margin) {
        bestPosition.top = vh - tooltipHeight - margin;
      }
      
      // If still doesn't fit vertically, try below the selection
      if (bestPosition.top < margin) {
        bestPosition.top = rect.bottom + spacing;
        if (bestPosition.top + tooltipHeight > vh - margin) {
          bestPosition.top = vh - tooltipHeight - margin;
        }
      }
    }
    
    // Apply the position
    Object.assign(tooltip.style, {
      left: `${Math.round(bestPosition.left)}px`,
      top: `${Math.round(bestPosition.top)}px`
    });
    
    // Store position info for debugging (optional)
    tooltip.setAttribute('data-position', bestPosition.name || 'adjusted');
  }

  function showTooltipUI() {
    tooltip.style.display = 'block';
    updateDarkMode();
    requestAnimationFrame(() => tooltip.classList.add('show'));
  }

  function repositionTooltip() {
    if (selectionRect && tooltip.style.display !== 'none') {
      positionTooltipNearRect(selectionRect);
    }
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

    getCachedSelector('wordTitle', '.word-title').textContent = currentSelection.length > 50 
      ? currentSelection.substring(0, 47) + '...' 
      : currentSelection;
    updateTranslationTitle();

    const defSlider = getCachedSelector('defSlider', '.definition-slider');
    const transSlider = getCachedSelector('transSlider', '.translation-slider');

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
    const defContainer = getCachedSelector('defContainer', '.definition-section .content-container');
    const transContainer = getCachedSelector('transContainer', '.translation-section .content-container');
    if (defContainer) smoothHeightTransition(defContainer, 60, true);
    if (transContainer) smoothHeightTransition(transContainer, 80, true);

    // Fetch definitions
    try {
      const defResponse = await browser.runtime.sendMessage({ 
        type: MESSAGE_TYPES.GET_DEFINITION, 
        word: currentSelection 
      });
      
            if (defResponse.success) {
        renderDefinitionPages(defResponse.data.defs);
        renderSynAnt(defResponse.data.synonyms, defResponse.data.antonyms);
      } else {
        defSlider.textContent = '';
        if (defResponse.error === 'Definitions are only available for English words') {
          const infoPage = createElement('div', 'content-page');
          infoPage.appendChild(createElement('div', 'definition-content info', 
            'Definitions are only available for English words. Please select English as the source language.'));
          defSlider.appendChild(infoPage);
        } else {
          defSlider.appendChild(createContentPage(defResponse.error, true));
        }
        renderSynAnt([], []);
      }
      
      // Reposition tooltip after definition content is loaded
      requestAnimationFrame(() => {
        requestAnimationFrame(() => repositionTooltip());
      });
    } catch (err) {
      defSlider.textContent = '';
      defSlider.appendChild(createContentPage(ERROR_MESSAGES.NETWORK_ERROR, true));
      renderSynAnt([], []);
    }

    // Fetch translations
    try {
      const transResponse = await browser.runtime.sendMessage({ 
        type: MESSAGE_TYPES.GET_TRANSLATION, 
        text: currentSelection 
      });
      
      if (transResponse.success) {
        renderTranslationPages(transResponse.data.translations);
      } else {
        transSlider.textContent = '';
        transSlider.appendChild(createContentPage(transResponse.error, true));
      }
      
      // Reposition tooltip after translation content is loaded
      requestAnimationFrame(() => {
        requestAnimationFrame(() => repositionTooltip());
      });
    } catch (err) {
      transSlider.textContent = '';
      transSlider.appendChild(createContentPage(ERROR_MESSAGES.NETWORK_ERROR, true));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => repositionTooltip());
      });
    }

    // Update word count
    try {
      await browser.runtime.sendMessage({ type: MESSAGE_TYPES.UPDATE_WORD_COUNT });
    } catch (e) {
      console.warn('Failed to update word count:', e);
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

  // Initialize
  loadSettings();

  console.log('WordGlance extension loaded. Select text and click the 📖 icon.');
})();
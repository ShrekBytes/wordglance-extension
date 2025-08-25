/*
  Background Script: WordGlance Extension
  Handles API calls, cache management, settings, and message routing
*/

// Background-specific configuration
const CONFIG = {
  maxDefinitions: 9,
  maxTranslations: 8,
  maxSynonyms: 6,
  maxAntonyms: 6,
  cacheSize: 500,
  apiTimeout: 100000
};

// State management
let settings = {
  targetLanguage: DEFAULT_VALUES.TARGET_LANGUAGE,
  sourceLanguage: DEFAULT_VALUES.SOURCE_LANGUAGE,
  darkMode: DEFAULT_VALUES.DARK_MODE
};

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

// Settings management
async function loadSettings() {
  try {
    const stored = await browser.storage.local.get([
      STORAGE_KEYS.TARGET_LANGUAGE,
      STORAGE_KEYS.SOURCE_LANGUAGE,
      STORAGE_KEYS.DARK_MODE
    ]);
    
    settings.targetLanguage = stored[STORAGE_KEYS.TARGET_LANGUAGE] || DEFAULT_VALUES.TARGET_LANGUAGE;
    settings.sourceLanguage = stored[STORAGE_KEYS.SOURCE_LANGUAGE] || DEFAULT_VALUES.SOURCE_LANGUAGE;
    settings.darkMode = stored[STORAGE_KEYS.DARK_MODE] || DEFAULT_VALUES.DARK_MODE;
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
}

// Cache management
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

async function clearAllCaches() {
  caches.definitions.clear();
  caches.translations.clear();
  await browser.storage.local.set({
    [STORAGE_KEYS.CACHE_DEFINITIONS]: '{}',
    [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
  });
}

// API functions
async function xfetch(url, init = {}) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), CONFIG.apiTimeout);
  
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function fetchDefinition(word) {
  const key = sanitizeText(word)?.toLowerCase();
  if (!key) throw new Error('Invalid word');
  
  if (caches.definitions.has(key)) {
    return caches.definitions.get(key);
  }
  
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
  const cleanText = sanitizeText(text);
  if (!cleanText) throw new Error('Invalid text');
  
  const key = `${cleanText}::${settings.sourceLanguage}::${settings.targetLanguage}`;
  if (caches.translations.has(key)) {
    return caches.translations.get(key);
  }
  
  const requestId = `trans-${cleanText}-${settings.sourceLanguage}-${settings.targetLanguage}-${Date.now()}`;
  activeRequests.add(requestId);
  
  const params = new URLSearchParams({ dl: settings.targetLanguage, text: cleanText });
  if (settings.sourceLanguage !== 'auto') params.set('sl', settings.sourceLanguage);
  
  try {
    const res = await xfetch(`https://translation-1e79fb3f3adb.herokuapp.com/translate?${params}`);
    
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

async function updateWordCount() {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.TOTAL_WORDS_LEARNED);
    const current = stored[STORAGE_KEYS.TOTAL_WORDS_LEARNED] || 0;
    await browser.storage.local.set({
      [STORAGE_KEYS.TOTAL_WORDS_LEARNED]: current + 1
    });
    return current + 1;
  } catch (e) {
    console.warn('Failed to update word count:', e);
    return 0;
  }
}

// Message handling
browser.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    switch (msg.type) {
      case MESSAGE_TYPES.GET_SETTINGS:
        return {
          success: true,
          data: {
            targetLanguage: settings.targetLanguage,
            sourceLanguage: settings.sourceLanguage,
            darkMode: settings.darkMode
          }
        };
        
      case MESSAGE_TYPES.GET_DEFINITION:
        if (settings.sourceLanguage !== 'en' && settings.sourceLanguage !== 'auto') {
          return {
            success: false,
            error: 'Definitions are only available for English words'
          };
        }
        const defResult = await fetchDefinition(msg.word);
        return { success: true, data: defResult };
        
      case MESSAGE_TYPES.GET_TRANSLATION:
        const transResult = await fetchTranslation(msg.text);
        return { success: true, data: transResult };
        
      case MESSAGE_TYPES.UPDATE_WORD_COUNT:
        const newCount = await updateWordCount();
        return { success: true, data: { count: newCount } };
        
      case MESSAGE_TYPES.CLEAR_CACHE:
        await clearAllCaches();
        return { success: true };
        
      case MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE:
        caches.translations.clear();
        await browser.storage.local.set({
          [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
        });
        return { success: true };
        
      case MESSAGE_TYPES.WORDGLANCE_FETCH:
        // Fallback network proxy for content script
    const { url, init } = msg;
        const response = await fetch(url, init);
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Array.from(response.headers.entries()),
          text: await response.text()
        };
        
      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
});

// Storage change listener
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  
  if (changes[STORAGE_KEYS.TARGET_LANGUAGE]) {
    settings.targetLanguage = changes[STORAGE_KEYS.TARGET_LANGUAGE].newValue || DEFAULT_VALUES.TARGET_LANGUAGE;
  }
  
  if (changes[STORAGE_KEYS.SOURCE_LANGUAGE]) {
    settings.sourceLanguage = changes[STORAGE_KEYS.SOURCE_LANGUAGE].newValue || DEFAULT_VALUES.SOURCE_LANGUAGE;
  }
  
  if (changes[STORAGE_KEYS.DARK_MODE]) {
    settings.darkMode = changes[STORAGE_KEYS.DARK_MODE].newValue || DEFAULT_VALUES.DARK_MODE;
  }
});

// Initialize
loadSettings();
loadCaches();

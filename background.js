/*
  Background Script: WordGlance Extension
  Handles API calls, cache management, settings, and message routing
*/

// State management
let settings = {
  targetLanguage: DEFAULT_VALUES.TARGET_LANGUAGE,
  sourceLanguage: DEFAULT_VALUES.SOURCE_LANGUAGE,
  darkMode: DEFAULT_VALUES.DARK_MODE
};

const caches = {
  definitions: new LRUCache(CONFIG.cacheSize),
  translations: new LRUCache(CONFIG.cacheSize)
};

// Settings management with proper boolean handling
async function loadSettings() {
  const stored = await StorageUtils.get([
    STORAGE_KEYS.TARGET_LANGUAGE,
    STORAGE_KEYS.SOURCE_LANGUAGE,
    STORAGE_KEYS.DARK_MODE
  ]);
  
  // Fix: Use proper boolean handling instead of || operator
  settings.targetLanguage = StorageUtils.getValue(stored, STORAGE_KEYS.TARGET_LANGUAGE, DEFAULT_VALUES.TARGET_LANGUAGE);
  settings.sourceLanguage = StorageUtils.getValue(stored, STORAGE_KEYS.SOURCE_LANGUAGE, DEFAULT_VALUES.SOURCE_LANGUAGE);
  settings.darkMode = StorageUtils.getValue(stored, STORAGE_KEYS.DARK_MODE, DEFAULT_VALUES.DARK_MODE);
}

const settingsReady = loadSettings().catch(e => {
  console.warn('Settings load error:', e);
});

// Cache management with debounced saving
async function loadCaches() {
  try {
    const [defCache, transCache] = await Promise.all([
      StorageUtils.get(STORAGE_KEYS.CACHE_DEFINITIONS),
      StorageUtils.get(STORAGE_KEYS.CACHE_TRANSLATIONS)
    ]);
    
    if (defCache[STORAGE_KEYS.CACHE_DEFINITIONS]) {
      const defs = JSON.parse(defCache[STORAGE_KEYS.CACHE_DEFINITIONS]);
      caches.definitions.fromObject(defs);
    }
    
    if (transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]) {
      const trans = JSON.parse(transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]);
      caches.translations.fromObject(trans);
    }
  } catch (e) {
    console.warn('Cache loading error:', e);
  }
}

// Debounced cache saving to reduce storage writes
const saveCaches = debounce(async () => {
  try {
    await StorageUtils.set({
      [STORAGE_KEYS.CACHE_DEFINITIONS]: JSON.stringify(caches.definitions.toObject()),
      [STORAGE_KEYS.CACHE_TRANSLATIONS]: JSON.stringify(caches.translations.toObject())
    });
  } catch (e) {
    console.warn('Cache save error:', e);
  }
}, CONFIG.cacheSaveDelay);

async function clearAllCaches() {
  caches.definitions.clear();
  caches.translations.clear();
  await StorageUtils.set({
    [STORAGE_KEYS.CACHE_DEFINITIONS]: '{}',
    [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
  });
}

// API functions
async function fetchDefinition(word) {
  const key = TextUtils.sanitize(word)?.toLowerCase();
  if (!key) throw new Error('Invalid word');
  
  // Check cache first
  const cached = caches.definitions.get(key);
  if (cached) return cached;
  
  try {
    const res = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`
    );
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Extract definitions, synonyms, and antonyms
    const defs = [];
    const syns = new Set();
    const ants = new Set();
    
    (data || []).forEach(entry => {
      (entry.meanings || []).forEach(m => {
        // Collect synonyms and antonyms at meaning level
        (m.synonyms || []).forEach(s => syns.add(s));
        (m.antonyms || []).forEach(a => ants.add(a));
        
        // Collect definitions
        (m.definitions || []).forEach(d => {
          if (d.definition) {
            defs.push({
              definition: d.definition,
              partOfSpeech: m.partOfSpeech || '',
              example: d.example || ''
            });
          }
          // Collect synonyms and antonyms at definition level
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
    
    // Cache result and trigger debounced save
    caches.definitions.set(key, result);
    saveCaches();
    return result;
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
}

async function fetchTranslation(text) {
  const cleanText = TextUtils.sanitize(text);
  if (!cleanText) throw new Error('Invalid text');
  
  // Create cache key with language settings
  const key = `${cleanText}::${settings.sourceLanguage}::${settings.targetLanguage}`;
  
  // Check cache first
  const cached = caches.translations.get(key);
  if (cached) return cached;
  
  // Build query parameters
  const params = new URLSearchParams({ 
    dl: settings.targetLanguage, 
    text: cleanText 
  });
  if (settings.sourceLanguage !== 'auto') {
    params.set('sl', settings.sourceLanguage);
  }
  
  try {
    const res = await fetchWithTimeout(
      `https://translation-1e79fb3f3adb.herokuapp.com/translate?${params}`
    );
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Extract translations
    const translations = [];
    if (data?.['destination-text']) {
      translations.push(data['destination-text']);
      
      // Add alternative translations
      const allTranslations = data.translations?.['all-translations'] || [];
      for (const group of allTranslations) {
        if (Array.isArray(group) && group[0] && 
            group[0] !== data['destination-text'] && 
            !translations.includes(group[0])) {
          translations.push(group[0]);
          if (translations.length >= CONFIG.maxTranslations) break;
        }
      }
      
      // Add possible translations if we need more
      if (translations.length < CONFIG.maxTranslations) {
        const extra = (data.translations?.['possible-translations'] || [])
          .filter(t => t && !translations.includes(t));
        translations.push(...extra.slice(0, CONFIG.maxTranslations - translations.length));
      }
    }
    
    const result = { 
      translations: translations.slice(0, CONFIG.maxTranslations) 
    };
    
    // Cache result and trigger debounced save
    caches.translations.set(key, result);
    saveCaches();
    return result;
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
}

async function updateWordCount() {
  try {
    const current = await StorageUtils.getSetting(STORAGE_KEYS.TOTAL_WORDS_LEARNED, 0);
    const newCount = current + 1;
    await StorageUtils.set({ [STORAGE_KEYS.TOTAL_WORDS_LEARNED]: newCount });
    return newCount;
  } catch (e) {
    console.warn('Failed to update word count:', e);
    return 0;
  }
}

// Message handling
browser.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    await settingsReady;

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
        await StorageUtils.set({
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

// Storage change listener with proper boolean handling
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  
  if (changes[STORAGE_KEYS.TARGET_LANGUAGE]) {
    settings.targetLanguage = changes[STORAGE_KEYS.TARGET_LANGUAGE].newValue ?? DEFAULT_VALUES.TARGET_LANGUAGE;
  }
  
  if (changes[STORAGE_KEYS.SOURCE_LANGUAGE]) {
    settings.sourceLanguage = changes[STORAGE_KEYS.SOURCE_LANGUAGE].newValue ?? DEFAULT_VALUES.SOURCE_LANGUAGE;
  }
  
  if (changes[STORAGE_KEYS.DARK_MODE]) {
    // Fix: Use nullish coalescing to properly handle false values
    settings.darkMode = changes[STORAGE_KEYS.DARK_MODE].newValue ?? DEFAULT_VALUES.DARK_MODE;
  }
});

// Clear caches on browser startup to ensure fresh data
browser.runtime.onStartup.addListener(async () => {
  console.log('WordGlance: Clearing caches on browser startup');
  await clearAllCaches();
});

// Initialize
loadCaches();

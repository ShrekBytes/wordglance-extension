/*
  Background Script: WordGlance Extension
  Handles API calls, cache management, settings, and message routing
*/

const settings = SettingsUtils.createDefaults();

const caches = {
  definitions: new LRUCache(),
  translations: new LRUCache()
};

async function loadSettings() {
  Object.assign(settings, await SettingsUtils.loadFromStorage());

  // Guard against both being off, even from a stale or externally edited stored state
  if (!settings.enableDefinitions && !settings.enableTranslations) {
    settings.enableTranslations = true;
    await StorageUtils.set({ [STORAGE_KEYS.ENABLE_TRANSLATIONS]: true });
  }
}

const settingsReady = loadSettings().catch(e => {
  console.warn('Settings load error:', e);
});

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

const cachesReady = loadCaches();

async function persistCaches() {
  try {
    await StorageUtils.set({
      [STORAGE_KEYS.CACHE_DEFINITIONS]: JSON.stringify(caches.definitions.toObject()),
      [STORAGE_KEYS.CACHE_TRANSLATIONS]: JSON.stringify(caches.translations.toObject())
    });
  } catch (e) {
    console.warn('Cache save error:', e);
  }
}

// Debounced during normal use to reduce storage writes; see onSuspend below for the
// immediate flush needed when the debounce timer won't get a chance to fire.
const saveCaches = debounce(persistCaches, CONFIG.cacheSaveDelay);

async function clearAllCaches() {
  caches.definitions.clear();
  caches.translations.clear();
  await StorageUtils.set({
    [STORAGE_KEYS.CACHE_DEFINITIONS]: '{}',
    [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
  });
}

function parseDictionaryApiResult(data) {
  const defs = [];
  const syns = new Set();
  const ants = new Set();
  let audio = '';

  (data || []).forEach(entry => {
    if (!audio) {
      const withAudio = (entry.phonetics || []).find(p => p.audio);
      if (withAudio) {
        // Some entries return protocol-relative URLs (e.g. "//...")
        audio = withAudio.audio.startsWith('//') ? `https:${withAudio.audio}` : withAudio.audio;
      }
    }

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

  return {
    defs: defs.slice(0, CONFIG.maxDefinitions),
    synonyms: Array.from(syns).slice(0, CONFIG.maxSynonyms),
    antonyms: Array.from(ants).slice(0, CONFIG.maxAntonyms),
    audio
  };
}

function parseDatamuseDefinition(rawDefinition) {
  const separator = rawDefinition.indexOf('\t');
  const code = separator === -1 ? '' : rawDefinition.slice(0, separator);
  const definition = (separator === -1 ? rawDefinition : rawDefinition.slice(separator + 1)).trim();
  const partsOfSpeech = {
    n: 'noun',
    v: 'verb',
    adj: 'adjective',
    adv: 'adverb'
  };

  return {
    definition,
    partOfSpeech: partsOfSpeech[code] || code,
    example: ''
  };
}

async function fetchDatamuseWords(params) {
  const query = new URLSearchParams(params);
  const response = await fetchWithTimeout(`${API_ENDPOINTS.DICTIONARY_FALLBACK}?${query}`);
  if (!response.ok) throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  return response.json();
}

async function fetchFallbackDefinition(key) {
  // qe=sp makes the first result describe the exact query instead of a similarly
  // spelled word. Definitions are sourced from Wiktionary and WordNet by Datamuse.
  const entries = await fetchDatamuseWords({
    sp: key,
    qe: 'sp',
    md: 'd',
    max: '1'
  });
  const entry = Array.isArray(entries)
    ? entries.find(item => Array.isArray(item.defs) && item.defs.length)
    : null;

  if (!entry) throw new Error(ERROR_MESSAGES.NO_DEFINITION);

  // Related-word lookups are useful extras, but they should never make an otherwise
  // successful definition fail if either optional request is unavailable.
  const [synonymResult, antonymResult] = await Promise.allSettled([
    fetchDatamuseWords({ rel_syn: key, max: String(CONFIG.maxSynonyms) }),
    fetchDatamuseWords({ rel_ant: key, max: String(CONFIG.maxAntonyms) })
  ]);
  const wordsFrom = result => result.status === 'fulfilled' && Array.isArray(result.value)
    ? result.value.map(item => item.word).filter(Boolean)
    : [];

  return {
    defs: entry.defs
      .map(parseDatamuseDefinition)
      .filter(def => def.definition)
      .slice(0, CONFIG.maxDefinitions),
    synonyms: wordsFrom(synonymResult).slice(0, CONFIG.maxSynonyms),
    antonyms: wordsFrom(antonymResult).slice(0, CONFIG.maxAntonyms),
    audio: ''
  };
}

async function fetchDefinition(word) {
  const key = TextUtils.sanitize(word)?.toLowerCase();
  if (!key) throw new Error(ERROR_MESSAGES.INVALID_WORD);

  // Ensure the persisted cache has actually been loaded into memory before checking it -
  // otherwise a request arriving right as a suspended background script wakes up could
  // miss an entry that's already sitting in storage.
  await cachesReady;
  const cached = caches.definitions.get(key);
  if (cached) return cached;

  let primaryStatus = null;
  try {
    const res = await fetchWithTimeout(
      `${API_ENDPOINTS.DICTIONARY}${encodeURIComponent(key)}`
    );
    primaryStatus = res.status;

    if (res.ok) {
      const result = parseDictionaryApiResult(await res.json());
      if (result.defs.length) {
        caches.definitions.set(key, result);
        saveCaches();
        return result;
      }
    }
  } catch (e) {
    // Network, timeout, and malformed-response failures all fall through to the
    // independent provider below.
  }

  try {
    const result = await fetchFallbackDefinition(key);
    if (!result.defs.length) throw new Error(ERROR_MESSAGES.NO_DEFINITION);

    caches.definitions.set(key, result);
    saveCaches();
    return result;
  } catch (e) {
    if (primaryStatus === 404 || e.message === ERROR_MESSAGES.NO_DEFINITION) {
      throw new Error(ERROR_MESSAGES.NO_DEFINITION);
    }
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
}

async function fetchTranslation(text) {
  const cleanText = TextUtils.sanitize(text);
  if (!cleanText) throw new Error(ERROR_MESSAGES.INVALID_TEXT);

  const key = `${cleanText}::${settings.sourceLanguage}::${settings.targetLanguage}`;
  await cachesReady;
  const cached = caches.translations.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    dl: settings.targetLanguage,
    text: cleanText
  });
  if (settings.sourceLanguage !== 'auto') {
    params.set('sl', settings.sourceLanguage);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      `${API_ENDPOINTS.TRANSLATION}?${params}`
    );
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  if (!res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  try {
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

browser.runtime.onMessage.addListener(async (msg) => {
  try {
    await settingsReady;

    switch (msg.type) {
      case MESSAGE_TYPES.GET_SETTINGS:
        return {
          success: true,
          data: {
            targetLanguage: settings.targetLanguage,
            sourceLanguage: settings.sourceLanguage,
            darkMode: settings.darkMode,
            formFieldsEnabled: settings.formFieldsEnabled,
            triggerPosition: settings.triggerPosition,
            enableDefinitions: settings.enableDefinitions,
            enableTranslations: settings.enableTranslations
          }
        };

      case MESSAGE_TYPES.GET_DEFINITION: {
        if (!settings.enableDefinitions) {
          return { success: false, error: ERROR_MESSAGES.DEFINITIONS_DISABLED };
        }
        if (settings.sourceLanguage !== 'en' && settings.sourceLanguage !== 'auto') {
          return {
            success: false,
            error: ERROR_MESSAGES.SOURCE_NOT_ENGLISH
          };
        }
        const defResult = await fetchDefinition(msg.word);
        return { success: true, data: defResult };
      }

      case MESSAGE_TYPES.GET_TRANSLATION: {
        if (!settings.enableTranslations) {
          return { success: false, error: ERROR_MESSAGES.TRANSLATIONS_DISABLED };
        }
        const transResult = await fetchTranslation(msg.text);
        return { success: true, data: transResult };
      }

      case MESSAGE_TYPES.CLEAR_CACHE:
        await clearAllCaches();
        return { success: true };

      case MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE:
        caches.translations.clear();
        await StorageUtils.set({
          [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
        });
        return { success: true };

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

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  SettingsUtils.applyChanges(settings, changes);
});

// Clear caches on browser startup to ensure fresh data.
// Waits for the initial cache load first, otherwise a load that resolves after
// this runs would repopulate the in-memory cache with the data we just cleared.
browser.runtime.onStartup.addListener(async () => {
  await cachesReady;
  await clearAllCaches();
});

// This is a non-persistent background script - Firefox can unload it after a period
// of inactivity. onSuspend is the last chance to flush any cache writes still sitting
// in the debounce window from saveCaches(), so they aren't lost before the next wake.
browser.runtime.onSuspend.addListener(persistCaches);

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

async function fetchDefinition(word) {
  const key = TextUtils.sanitize(word)?.toLowerCase();
  if (!key) throw new Error(ERROR_MESSAGES.INVALID_WORD);

  // Ensure the persisted cache has actually been loaded into memory before checking it -
  // otherwise a request arriving right as a suspended background script wakes up could
  // miss an entry that's already sitting in storage.
  await cachesReady;
  const cached = caches.definitions.get(key);
  if (cached) return cached;

  let res;
  try {
    res = await fetchWithTimeout(
      `${API_ENDPOINTS.DICTIONARY}${encodeURIComponent(key)}`
    );
  } catch (e) {
    // The fetch itself failed - offline, DNS, timed out, etc. This is a genuine connection problem.
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // The API responds with 404 when the word simply has no entry - that's not a connection
  // problem, so it gets its own accurate message instead of the generic network error.
  if (res.status === 404) {
    throw new Error(ERROR_MESSAGES.NO_DEFINITION);
  }
  if (!res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  try {
    const data = await res.json();

    // Extract definitions, synonyms, antonyms, and pronunciation audio
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
      antonyms: Array.from(ants).slice(0, CONFIG.maxAntonyms),
      audio
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

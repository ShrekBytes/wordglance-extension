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

// The dictionary that ships in the package, read once on the first Lookup that
// needs it and then held as a map from headword to Senses. See ADR-0002.
//
// The promise is kept rather than the entries, so a burst of Lookups - or two
// arriving together while the background is waking - share one read. Nothing is
// loaded at startup: this is a non-persistent background script, so it is woken
// for every message, and a reader who only ever translates would otherwise pay
// for 5 MB of dictionary on every wake to read none of it.
let bundleLoad = null;

function loadBundle() {
  if (!bundleLoad) {
    // A plain fetch, not fetchWithTimeout. CONFIG.apiTimeout is a timeout on a
    // provider over the network, and a packaged read is not one: applying it
    // here would abort a cold background page part-way through inflating 5 MB,
    // and because a failure is remembered that one slow read would send every
    // Definition in the session to the provider. A file in the extension's own
    // directory resolves or it does not.
    bundleLoad = (async () => {
      const res = await fetch(BUNDLED_DICTIONARY);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Decompressed through a stream rather than by inflating the bytes and
      // calling text() on them, so the 20 MB of text is never held alongside the
      // map it becomes. The map is what stays resident; this string is not
      // referenced once JSON.parse has returned.
      const text = await new Response(
        res.body.pipeThrough(new DecompressionStream('gzip'))
      ).text();

      const parsed = JSON.parse(text);
      return (parsed && parsed.entries) || {};
    })().catch(e => {
      // A missing or corrupt artefact is a packaging fault, not a Lookup fault.
      // Fall through to the provider rather than failing every Definition.
      //
      // The failure is remembered, and that is right here rather than a shortcut:
      // every way this read can fail is permanent. The file is not there, the
      // gzip is truncated, the JSON is not the shape the generator writes - none
      // of those change while the browser runs. Retrying would re-inflate the
      // same 5 MB on every Lookup for a result that cannot differ.
      console.warn('Bundled dictionary error:', e);
      return {};
    });
  }
  return bundleLoad;
}

// A Synonym and an Antonym are bare words, so a multi-word phrase is dropped
// rather than trimmed: "happy as a lark" is not a word, and trimming it to
// "happy" would assert a synonym the source did not. The artefact already
// applies this at build time; repeating it here means the rule lives with the
// payload, and a refreshed artefact with a looser budget cannot put a phrase
// where a single word belongs.
function bareRelations(list) {
  return (Array.isArray(list) ? list : []).filter(
    word => typeof word === 'string' && word.length > 0 && !/\s/.test(word)
  );
}

// The part of speech as the Tooltip shows it.
//
// Wiktionary's tags are abbreviations — `adj`, `adv`, `prep_phrase` — and the
// Tooltip prints a part of speech on its own line, so passing them through would
// put "adj" on screen where the provider path puts "adjective". A bundled
// Definition has to be indistinguishable from a fetched one.
//
// These are the 21 values the artefact actually contains, so the map is the
// measured set rather than a general one: a refresh that introduces a tag
// falls through to the tag itself, which shows the reader something rather
// than nothing. A tag worth explaining properly is a decision, not a default.
const PART_OF_SPEECH = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  name: 'proper noun',
  intj: 'interjection',
  prep: 'preposition',
  pron: 'pronoun',
  det: 'determiner',
  conj: 'conjunction',
  num: 'numeral',
  phrase: 'phrase',
  symbol: 'symbol',
  contraction: 'contraction',
  particle: 'particle',
  character: 'character',
  article: 'article',
  prep_phrase: 'prepositional phrase',
  postp: 'postposition',
  infix: 'infix',
  prefix: 'prefix'
};

const partOfSpeech = (pos) => PART_OF_SPEECH[pos] || pos || '';

// The payload for a Lookup answered from the bundle, in the shape the content
// script already renders, so a bundled Definition looks like any other.
//
// Synonyms and Antonyms are the Senses' own, walked in dictionary order and
// deduplicated. The artefact holds no entry-level list - each Sense carries its
// own - so there is nothing to flatten, which is what makes the flattening
// ADR-0002 forbids impossible here rather than merely avoided. What the payload
// cannot express, because the Tooltip shows one list per Lookup rather than one
// per Sense, is which Sense each of them came from; a reader on the second page
// of Definitions is reading a list drawn from all of them.
function bundlePayload(senses) {
  const defs = [];
  const synonyms = new Set();
  const antonyms = new Set();

  for (const sense of senses) {
    // A Sense carries one Example and one or more Definitions. The payload
    // pairs one Example with one Definition, so the Sense's Example goes with
    // the first Definition it shows - the one a reader reads first, and today
    // the only one, since the artefact budget is one Definition per Sense.
    const example = (sense.examples || [])[0] || '';
    for (const definition of sense.definitions || []) {
      if (!definition) continue;
      defs.push({ definition, partOfSpeech: partOfSpeech(sense.pos), example });
    }
    bareRelations(sense.synonyms).forEach(word => synonyms.add(word));
    bareRelations(sense.antonyms).forEach(word => antonyms.add(word));
  }

  return {
    defs: defs.slice(0, CONFIG.maxDefinitions),
    synonyms: Array.from(synonyms).slice(0, CONFIG.maxSynonyms),
    antonyms: Array.from(antonyms).slice(0, CONFIG.maxAntonyms),
    // The bundle carries no audio, and a Lookup that must not touch the
    // network cannot go and get any. Pronunciation is a live Field from a
    // Wiktionary request (issue #17); until it lands, a bundled Lookup shows no
    // pronounce button, which is that Field's documented empty outcome rather
    // than a broken one.
    audio: ''
  };
}

async function fetchDefinition(word) {
  // A Lookup is about one headword. A multi-word selection is rejected here,
  // before the bundle is read and before any request, so a phrase never reaches
  // a provider and never costs a decompression.
  const key = HeadwordUtils.normalize(word).toLowerCase();
  if (!key) throw new Error(ERROR_MESSAGES.INVALID_WORD);

  // The bundle answers before the cache and before the provider. It is in the
  // package, it costs nothing, and it is the data this extension is built
  // around, so where it has an answer that is the answer a reader gets.
  //
  // An entry with no Senses is treated as a miss for the same reason: the
  // generator drops a headword it cannot answer, so one here is a defect, and a
  // Lookup that reached the provider is more useful than one that did not.
  const bundled = (await loadBundle())[key];
  if (bundled && bundled.length) return bundlePayload(bundled);

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

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

// The Fields of a Lookup, from the Senses that answer it, in the shape the
// content script already renders, so that a Definition reads the same whichever
// source it came from.
//
// Each Sense's Definitions are paired with the Sense's part of speech and its
// first Example - the one a reader reads first - and the Senses' own relations
// are gathered in encounter order, then deduplicated and capped, so the Tooltip
// stays a readable size. A Sense that carries no Example still resolves its
// Definitions: a Field may be empty, and empty is a normal outcome.
//
// Neither source carries a recording. The artefact has no audio at all, and the
// provider serves a phonetic transcription rather than a file, so a recording
// comes off the Wiktionary page the Translation Field is read from - and a
// Lookup answered from either of them must not reach the network for one.
function fieldsFrom(senses) {
  const defs = [];
  const synonyms = new Set();
  const antonyms = new Set();

  for (const sense of senses) {
    const example = (sense.examples || [])[0] || '';
    for (const wording of sense.definitions || []) {
      const definition = (wording || '').trim();
      if (definition) defs.push({ definition, partOfSpeech: sense.partOfSpeech || '', example });
    }
    bareRelations(sense.synonyms).forEach(word => synonyms.add(word));
    bareRelations(sense.antonyms).forEach(word => antonyms.add(word));
  }

  return {
    defs: defs.slice(0, CONFIG.maxDefinitions),
    synonyms: Array.from(synonyms).slice(0, CONFIG.maxSynonyms),
    antonyms: Array.from(antonyms).slice(0, CONFIG.maxAntonyms),
    audio: ''
  };
}

// The payload for a Lookup answered from the bundle. The artefact holds one
// Definition per Sense - the budget its generator was given - and names a
// Sense's part of speech `pos`, where it holds a Wiktionary tag rather than the
// word the Tooltip prints. That is the one thing restated here.
//
// What the payload cannot express, because the Tooltip shows one list per Lookup
// rather than one per Sense, is which Sense each relation came from; a reader on
// the second page of Definitions is reading a list drawn from all of them.
function bundlePayload(senses) {
  return fieldsFrom(senses.map(sense => ({ ...sense, partOfSpeech: partOfSpeech(sense.pos) })));
}

// A Lookup is about one headword, so this is where a selection that is not one
// is refused - before the bundle is read and before any request is issued. Both
// Fields go through it, so a phrase can never reach a provider by either.
function headwordKey(word) {
  const key = HeadwordUtils.normalize(word).toLowerCase();
  if (!key) throw new Error(ERROR_MESSAGES.INVALID_WORD);
  return key;
}

// Every Sense under an Entry, in the order the Entry lists them. A Sense may
// carry sub-senses - a noun sense with one for each of its kinds - and a
// sub-sense is as much a distinct meaning of the headword as its parent is, so
// its Definition and its relations are the reader's as much as the parent's.
function* allSenses(senses) {
  for (const sense of Array.isArray(senses) ? senses : []) {
    if (!sense) continue;
    yield sense;
    yield* allSenses(sense.subsenses);
  }
}

// The payload for a Lookup answered by the live provider.
//
// An Entry holds several Senses under one part of speech, and that part of
// speech is the Entry's rather than any Sense's, so it is restated onto each of
// them. A sub-sense is a Sense of its own, so it is restated as one - which is
// the whole of the difference between this walk and the artefact's.
//
// Relations come from the Senses and never from the Entry. An Entry carries
// synonym and antonym lists of its own, and those belong to the headword rather
// than to any Sense: unsorted dumps that mix words belonging to different
// meanings and include multi-word phrases. ADR-0002 forbids surfacing them for
// the same reason the artefact carries no entry-level list.
function providerPayload(entries) {
  return fieldsFrom(entries.flatMap(entry => Array.from(allSenses(entry.senses), sense => ({
    definitions: [sense.definition],
    partOfSpeech: partOfSpeech(entry.partOfSpeech),
    examples: sense.examples,
    synonyms: sense.synonyms,
    antonyms: sense.antonyms
  }))));
}

// The languages a headword is asked of, in the order they are asked. English is
// last and always present: it is the fallback for a Source language the provider
// has no entry for, and it is where the bundle answers.
//
// 'auto' is a setting rather than a language, and 'en' is the language the
// bundle is written in, so neither asks for anything but English.
function definitionLanguages() {
  return settings.sourceLanguage === 'auto' || settings.sourceLanguage === 'en'
    ? ['en']
    : [settings.sourceLanguage, 'en'];
}

// The cached answer for a headword, keyed by the languages the Lookup asks of
// rather than by the headword alone. The same word is a different answer in the
// reader's Source language than in English, so one cannot stand in for the other.
function definitionCacheKey(key) {
  return `${key}::${definitionLanguages().join('-')}`;
}

// Remembers a provider's answer, so a repeated Lookup of the same headword in
// the same languages issues no request at all - the thesaurus's included, which
// would otherwise be asked again for relations it has already supplied.
//
// A bundled answer is never remembered: it made no request, so caching it grows
// extension storage for no saving, and it would put a second copy of the
// artefact's words where a reader can clear it and get the provider's answer
// back.
function rememberDefinition(key, payload) {
  caches.definitions.set(definitionCacheKey(key), payload);
  saveCaches();
}

// The Fields for a headword from the bundled dictionary, or null when the
// artefact does not carry it.
async function fromBundle(key) {
  const senses = (await loadBundle())[key];
  // An entry with no Senses is treated as a miss for the same reason: the
  // generator drops a headword it cannot answer, so one here is a defect, and a
  // Lookup that reached the provider is more useful than one that did not.
  return senses && senses.length ? bundlePayload(senses) : null;
}

// The Fields for a headword from the live provider, in one language, or null
// when it has no entry in that language.
//
// A successful response with no entries is this word having no entry rather
// than a failure, and it is the chain's way of moving on to the next source.
// Everything that can go wrong with the request itself is a failure of the whole
// Lookup, because the reader cannot be told a Definition does not exist when
// nothing was ever asked.
async function fromProvider(key, language) {
  // Ensure the persisted cache has actually been loaded into memory before checking it -
  // otherwise a request arriving right as a suspended background script wakes up could
  // miss an entry that's already sitting in storage.
  await cachesReady;
  const cacheKey = definitionCacheKey(key);
  const cached = caches.definitions.get(cacheKey);
  if (cached) return cached;

  let res;
  try {
    res = await fetchWithTimeout(
      `${API_ENDPOINTS.DICTIONARY}/${language}/${encodeURIComponent(key)}`
    );
  } catch (e) {
    // The fetch itself failed - offline, DNS, timed out, etc. This is a genuine connection problem.
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // The provider answers an unknown word with an empty success rather than a
  // 404, but a 404 is the same fact and is not a connection problem either, so
  // both are the chain's way of moving on.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  let entries;
  try {
    // The response also names the source its data came from and the licence that
    // data may be used under: Wiktionary content, CC BY-SA 4.0 - the licence the
    // bundled artefact carries too. That credit is one statement about the
    // dataset rather than a fact about a single response, so it is not carried
    // through the payload; the settings is where it is owed to the reader.
    entries = (await res.json()).entries;
  } catch (e) {
    // A body the extension cannot read is a failed request as far as a reader is
    // concerned: there is no answer in it to show, and a 200 carrying an outage
    // page is exactly that.
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
  if (!Array.isArray(entries) || !entries.length) return null;

  const payload = providerPayload(entries);

  // The thesaurus fills Synonym and Antonym, and nothing else, and only once
  // the bundle and this provider have both come up with neither. It supplies no
  // Definition and no Example sentence, so there is nothing of those for it to
  // be asked for.
  if (!payload.synonyms.length && !payload.antonyms.length) {
    Object.assign(payload, await thesaurusRelations(key));
  }

  rememberDefinition(key, payload);
  return payload;
}

// The words one relation has for a headword, or none when that request failed.
//
// Each relation is read on its own, and neither failure takes the other with it:
// the Field that did resolve stays visible, which is the rule the Tooltip
// follows when one Field fails and the others do not. A thesaurus outage must
// not take away the Definitions the reader came for.
async function relationWords(key, relation, limit) {
  try {
    const query = new URLSearchParams({ [relation]: key, max: String(limit) });
    const res = await fetchWithTimeout(`${API_ENDPOINTS.THESAURUS}?${query}`);
    if (!res.ok) throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
    const found = await res.json();
    // A list of `{ word, score }`, ranked strongest first. Multiword
    // expressions are in its vocabulary, so the rule that a Synonym is a bare
    // word applies here as it does at every other source.
    return bareRelations((Array.isArray(found) ? found : []).map(item => item && item.word))
      .slice(0, limit);
  } catch (e) {
    console.warn(`Thesaurus ${relation} error:`, e);
    return [];
  }
}

// The thesaurus, which fills Synonym and Antonym and nothing else.
//
// The two relations are two requests rather than one: asked for together they
// become a single constraint - results that are a synonym and an antonym of the
// same word, which for most words is none of them - and the answer is an empty
// list rather than an error.
//
// Its vocabulary is English, so this is an English relation asked of an English
// index. For a headword that is not English it answers with nothing, which is
// this Field being empty rather than the Lookup failing.
async function thesaurusRelations(key) {
  const [synonyms, antonyms] = await Promise.all([
    relationWords(key, 'rel_syn', CONFIG.maxSynonyms),
    relationWords(key, 'rel_ant', CONFIG.maxAntonyms)
  ]);
  return { synonyms, antonyms };
}

// The Fields of one Lookup of a headword's Definition, Example, Synonym and
// Antonym. A headword is asked of the reader's Source language when they have
// named one, and of English either way; the bundled dictionary answers the
// English end of that, and the live provider is asked wherever the bundle has
// nothing. Synonym and Antonym fall to the thesaurus once neither the bundle
// nor the provider has any.
//
// The bundle sits at the English end rather than at the front of the chain
// because it holds English Senses: a reader who named a Source language asked a
// question about their own language, and the bundle cannot answer it however
// well it covers the word. English is the fallback, and there the bundle answers
// without a request, which is what keeps a common word free for them too.
async function fetchDefinition(word) {
  const key = headwordKey(word);

  for (const language of definitionLanguages()) {
    if (language === 'en') {
      const bundled = await fromBundle(key);
      if (bundled) return bundled;
    }

    const payload = await fromProvider(key, language);
    if (payload) return payload;
  }

  // Every source came up empty. The thesaurus is asked last, and it can still
  // have words related to a headword no dictionary defines: a reader who
  // selected a piece of jargon or a product name is better served by the words
  // around it than by nothing at all, and the Tooltip prints its not-found for
  // the empty Definition Field beside them.
  const relations = await thesaurusRelations(key);
  if (!relations.synonyms.length && !relations.antonyms.length) {
    throw new Error(ERROR_MESSAGES.NO_DEFINITION);
  }

  const payload = { defs: [], ...relations, audio: '' };
  rememberDefinition(key, payload);
  return payload;
}

// What a Translation Lookup has to say when the reader has asked for nothing:
// their Source language is set to their Target language, so the headword is
// already in the language they asked to read it in. Decided here, before any
// request, so the Lookup costs nothing at all.
const NOTHING_TO_TRANSLATE = { translations: [], audio: '' };

// --- The Translation Field's fallbacks -------------------------------------
//
// Three free machine-translation providers behind the headword's Wiktionary
// page, asked in order when that page carries no equivalent in the reader's
// Target language. ADR-0005 records the ordering, the risk that all three are
// undocumented endpoints whose terms prohibit automated access, and why a
// failed request from one of them is the next one being asked rather than the
// Lookup failing.

// A request whose only purpose is to find out whether one provider is
// answering: the response when it succeeded, and null for anything else - a
// refused request, a server error, a timeout. A body the extension cannot read
// is a failure of the body rather than of the request, and fails where it is
// read.
//
// The chain's shorter request budget is applied here so that a hop cannot
// forget it: a provider that cannot answer in four seconds is a provider that
// is down, and the chain may ask four of them.
async function askProvider(url, options = {}) {
  try {
    const res = await fetchWithTimeout(url, options, CONFIG.fallbackTimeout);
    return res.ok ? res : null;
  } catch (e) {
    console.warn('Translation fallback error:', e);
    return null;
  }
}

// A provider's body as the JSON it serves, or null. The parse is a failure of
// its own - a challenge page and an outage page both arrive with a healthy
// status - and it means the same as the request failing: no answer here to
// read.
async function askJson(url) {
  const res = await askProvider(url);
  if (!res) return null;
  try {
    return await res.json();
  } catch (e) {
    console.warn('Translation fallback error:', e);
    return null;
  }
}

// One word as a Translation Field of one, or none when there is no word. The
// two providers answering with a single string answer with the same shape, so
// the shape is decided once rather than in both of them.
const oneWord = word => (typeof word === 'string' && word.trim() ? [word.trim()] : []);

// The language a provider is asked to translate from: the reader's own Source
// language where they have named one, and `unasked` otherwise.
//
// Those are not the same word, and the caller says which of the two it wants.
// One provider can work the language out for itself and is asked to, because
// the reader's Source language is 'auto' more often than not and a headword
// read off a Japanese page as English is worse than no Translation at all. The
// other two name a source language or refuse the request outright - `auto` is
// not a language either of them serves - and are told English, which is the
// language the Wiktionary page is read in anyway, so a source the reader never
// named is the same word either way.
function translationSource(unasked) {
  return settings.sourceLanguage === 'auto' ? unasked : settings.sourceLanguage;
}

// The alternatives the first provider ranked for a headword, best first.
//
// Its answer is an array whose dictionary block sits at a fixed position: the
// headword, a null, and then the ranked alternatives, each of which is a list
// whose own first element is the word.
//
// The block also ends with metadata - the ranges the alternatives cover, the
// headword again, two counts - and those are left out by not being lists of
// that shape rather than by counting entries, so a block that grows a field
// costs this Field rather than the Lookup around it. The headword is one of
// the words that survives, and the echo rule in the chain below is what drops
// it. A headword the provider has no dictionary entry for answers with no
// block at all.
function readRanked(body) {
  const entry = Array.isArray(body) ? body[5] : null;
  const ranked = entry && Array.isArray(entry[2]) ? entry[2] : [];
  return ranked
    .map(alternative => (Array.isArray(alternative) ? alternative[0] : ''))
    .filter(word => typeof word === 'string' && word.trim())
    .map(word => word.trim());
}

// The first provider: one GET, answering with a ranked list.
async function rankedAlternatives(key) {
  const query = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: translationSource('auto'),
    tl: settings.targetLanguage,
    dt: 'at',
    q: key
  });
  return readRanked(await askJson(`${API_ENDPOINTS.RANKED_ALTERNATIVES}?${query}`));
}

// The one word the second provider has.
//
// It answers a request it could not serve with a status of its own and a
// human-readable complaint where the word would be - "INVALID LANGUAGE PAIR
// SPECIFIED" and the like. The status is what says whether there is a word
// here, and the text is only read once the status says so: a reader whose
// Target language this vendor does not carry would otherwise be shown the
// complaint as their Translation.
function readSingle(body) {
  if (!body || body.responseStatus !== 200) return [];
  return oneWord(body.responseData && body.responseData.translatedText);
}

// The second provider: a different vendor on a different host, one GET.
async function singleTranslation(key) {
  const query = new URLSearchParams({
    q: key,
    langpair: `${translationSource('en')}|${settings.targetLanguage}`
  });
  return readSingle(await askJson(`${API_ENDPOINTS.SINGLE_TRANSLATION}?${query}`));
}

// The session token the third provider will not answer without, read out of the
// page it hands it out on.
//
// A translator that serves a challenge instead of that page, or serves it
// without the token, has nothing here to find - which is this hop failing, and
// exactly what the other two failing looks like.
const VENDOR_TOKEN = /IG:"([A-F0-9]+)"/i;

async function vendorSession() {
  const res = await askProvider(API_ENDPOINTS.VENDOR_TRANSLATION_SESSION);
  if (!res) return '';
  try {
    const token = VENDOR_TOKEN.exec(await res.text());
    return token ? token[1] : '';
  } catch (e) {
    console.warn('Translation fallback session error:', e);
    return '';
  }
}

// The one word the third vendor has. An answer that is not a list holding one
// translated string is this provider saying something other than an answer - a
// challenge, most often - and is a failure like any other.
//
// No cookie rides along with either request. The token is the whole of what
// this hop has, and a reader's session on somebody else's site has no business
// travelling with a word they selected.
async function vendorTranslation(key) {
  const token = await vendorSession();
  if (!token) return [];

  const res = await askProvider(API_ENDPOINTS.VENDOR_TRANSLATION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      fromLang: translationSource('en'),
      text: key,
      to: settings.targetLanguage,
      IG: token,
      IID: 'translator.5028.1'
    })
  });
  if (!res) return [];

  try {
    const answer = await res.json();
    return oneWord(Array.isArray(answer) && answer[0] ? answer[0].text : '');
  } catch (e) {
    console.warn('Translation fallback error:', e);
    return [];
  }
}

// The fallbacks, in the order they are asked. A provider answering with a
// ranked list comes before one answering with a single string and never after
// it: several alternatives inside one Target language is a requirement rather
// than a nicety, so a single string is a fallback and is not reached while a
// ranked provider is available.
const TRANSLATION_FALLBACKS = [rankedAlternatives, singleTranslation, vendorTranslation];

// Whether a word a provider returned is the headword back again. Case alone,
// because the headword has already been normalised and lowercased into the key,
// and a provider's word is not a reader's selection - so HeadwordUtils, which
// decides what a reader may select, has no say here.
const sameWord = (word, key) => word.toLowerCase() === key;

// The words the chain has for a headword, or none when every provider came up
// empty.
//
// A word identical to the headword is dropped wherever it appears. A machine
// translator handed a Bengali word and asked for Bengali hands the word
// straight back, and showing a reader the word they selected as its own
// Translation is the one thing this Field must never do. The Source-equals-
// Target setting is suppressed before any request is made, so this catches the
// case that setting cannot: a reader who left their Source language on
// automatic and selected a word already in their Target language. A word that
// really is spelled the same in both languages is lost to it, and the page
// above is where such a word is answered instead.
async function fallbackTranslations(key) {
  for (const ask of TRANSLATION_FALLBACKS) {
    const words = (await ask(key)).filter(word => !sameWord(word, key));
    if (words.length) return words;
  }
  return [];
}

async function fetchTranslation(word) {
  const key = headwordKey(word);

  if (translationSuppressed(settings)) {
    return NOTHING_TO_TRANSLATE;
  }

  // Keyed by the Target language because both Fields read out of the page depend
  // on it: which equivalents to list, and which recording to prefer.
  const cacheKey = `${key}::${settings.targetLanguage}`;
  await cachesReady;
  const cached = caches.translations.get(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({ title: key, action: 'raw' });

  let res;
  try {
    res = await fetchWithTimeout(`${API_ENDPOINTS.WIKTIONARY}?${query}`);
  } catch (e) {
    // The fetch itself failed - offline, DNS, timed out, etc. This is a genuine connection problem.
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // A headword Wiktionary has no page for has no equivalents in the reader's
  // Target language either, and that is the Field being empty rather than the
  // Lookup failing: the reader still gets the Definitions they came for. The
  // distinction from the server failure below is load-bearing - reporting an
  // outage as "no equivalents" would tell a reader their word has none when
  // nothing was ever asked.
  if (res.status !== 404 && !res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  let page;
  try {
    // No page is an empty page. Everything the page carries is then nothing, and
    // the chain below is asked for the equivalents the page did not have.
    const markup = res.status === 404 ? '' : await res.text();
    page = {
      translations: WiktionaryUtils.readTranslations(markup, settings.targetLanguage),
      audio: WiktionaryUtils.readAudio(markup, settings.targetLanguage)
    };
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // Wiktionary answered, and it has nothing for this reader's Target language.
  // That is the coverage gap the fallbacks are for, and the only thing that
  // starts the chain: a page carrying several equivalents never costs a request
  // to the providers behind it.
  const translations = page.translations.length
    ? page.translations
    : await fallbackTranslations(key);

  // An empty Translation is not remembered. Three providers being down at the
  // same moment is a fact about the moment rather than about the word, and
  // remembering it would tell the reader their word has no Translation until
  // the browser next starts - which is the very outage the chain exists to
  // absorb. The Definition chain follows the same rule by throwing its
  // not-found rather than caching it.
  if (!translations.length) return { translations: [], audio: page.audio };

  const result = {
    translations: translations.slice(0, CONFIG.maxTranslations),
    audio: page.audio
  };

  // Cache result and trigger debounced save
  caches.translations.set(cacheKey, result);
  saveCaches();
  return result;
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
        const defResult = await fetchDefinition(msg.word);
        return { success: true, data: defResult };
      }

      case MESSAGE_TYPES.GET_TRANSLATION: {
        if (!settings.enableTranslations) {
          return { success: false, error: ERROR_MESSAGES.TRANSLATIONS_DISABLED };
        }
        const transResult = await fetchTranslation(msg.word);
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

/*
  Behaviour of the background script, driven through its real message contract.

  Every test here sends a message the content script would send and asserts on
  the payload that comes back and on the URLs the background asked for. No test
  calls a function the background defines internally, so a provider can be
  swapped for an equivalent one without breaking these.

  The bundled dictionary is served through the same seam rather than around it,
  so a test asserting a Lookup is offline asserts on `networkUrls` - what the
  background asked of the network - and not on `requestedUrls`, which also
  counts the read of the file inside its own package.
*/

const assert = require('node:assert/strict');
const test = require('node:test');

const { createBackground, jsonResponse, notFound } = require('./harness');

const DICTIONARY = 'api.dictionaryapi.dev';
const TRANSLATION = 'translation-1e79fb3f3adb.herokuapp.com';

const SETTINGS_KEYS = {
  enableDefinitions: 'wordglance-enable-definitions',
  enableTranslations: 'wordglance-enable-translations',
  sourceLanguage: 'wordglance-source-language',
  targetLanguage: 'wordglance-target-language'
};

const dictionaryEntry = (word, overrides = {}) => jsonResponse([
  {
    word,
    phonetics: [{ audio: '' }],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          {
            definition: 'A thing made or used for a particular purpose.',
            example: 'She packed her tools.',
            synonyms: ['instrument', 'utensil'],
            antonyms: []
          }
        ],
        synonyms: ['device'],
        antonyms: ['person']
      }
    ],
    ...overrides
  }
]);

// The bundled dictionary is empty for every test in this section: each is about
// the live provider, and a headword the bundle happens to carry would answer
// from the package before the provider was ever reached. The bundle is covered
// on its own terms below.
const NO_BUNDLE = { dictionary: {} };

// --- Current behaviour ---------------------------------------------------

test('a single-word Lookup returns Definitions, Synonyms, Antonyms and audio', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) {
        return dictionaryEntry('hammer', {
          phonetics: [{ audio: '//audio.example/hammer.mp3' }]
        });
      }
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'Hammer' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, {
    defs: [
      {
        definition: 'A thing made or used for a particular purpose.',
        partOfSpeech: 'noun',
        example: 'She packed her tools.'
      }
    ],
    synonyms: ['device', 'instrument', 'utensil'],
    antonyms: ['person'],
    audio: 'https://audio.example/hammer.mp3'
  });
  assert.deepEqual(background.networkUrls, [
    `https://api.dictionaryapi.dev/api/v2/entries/en/hammer`
  ]);
});

test('Definitions and Examples are capped at the configured limits', async () => {
  const definitions = Array.from({ length: 12 }, (_, i) => ({
    definition: `Meaning ${i}.`,
    example: `Example ${i}.`
  }));
  const synonyms = Array.from({ length: 10 }, (_, i) => `syn${i}`);
  const antonyms = Array.from({ length: 10 }, (_, i) => `ant${i}`);

  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? jsonResponse([{
      word: 'tool',
      phonetics: [],
      meanings: [{ partOfSpeech: 'noun', definitions, synonyms, antonyms }]
    }]) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'tool' });

  assert.equal(response.data.defs.length, 9);
  assert.equal(response.data.synonyms.length, 6);
  assert.equal(response.data.antonyms.length, 6);
});

test('a repeated Lookup of the same word issues no further request', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  const first = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  const second = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(first.success, true);
  assert.deepEqual(second.data, first.data);
  assert.equal(background.networkUrls.length, 1);
});

test('a word with no entry reports not-found rather than a connection error', async () => {
  const background = createBackground({
    fetch: url => (url.includes(DICTIONARY) ? notFound() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.deepEqual(response, { success: false, error: 'Definition not found' });
});

test('a failed request reports a connection error', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) throw new Error('offline');
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.deepEqual(response, {
    success: false,
    error: 'Connection error - please try again'
  });
});

test('a server failure is a connection error, not a not-found', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? jsonResponse({ error: 'boom' }, 500) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.error, 'Connection error - please try again');
});

test('settings come back with their defaults', async () => {
  const background = createBackground({});

  const response = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(response.success, true);
  assert.equal(response.data.targetLanguage, 'en');
  assert.equal(response.data.enableDefinitions, true);
  assert.equal(response.data.enableTranslations, true);
});

test('stored settings win over defaults', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.targetLanguage]: 'bn' }
  });

  const response = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(response.data.targetLanguage, 'bn');
});

test('a Translation Lookup returns the destination text and its alternatives', async () => {
  const background = createBackground({
    fetch: url => {
      if (url.includes(TRANSLATION)) {
        return jsonResponse({
          'destination-text': 'হাতুড়ি',
          translations: {
            'all-translations': [['হাতুড়ি'], ['মারিবল'], ['হাতুড়ি']],
            'possible-translations': ['অস্ত্র', 'যন্ত্র']
          }
        });
      }
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });

  assert.deepEqual(response, {
    success: true,
    data: { translations: ['হাতুড়ি', 'মারিবল', 'অস্ত্র', 'যন্ত্র'] }
  });
  assert.equal(background.requestedUrls.length, 1);
  const url = new URL(background.requestedUrls[0]);
  assert.equal(url.searchParams.get('dl'), 'en');
  assert.equal(url.searchParams.get('text'), 'hammer');
  // 'auto' is the default source, and an auto-detect request must not send `sl`.
  assert.equal(url.searchParams.get('sl'), null);
});

test('a Translation Lookup is cached per language pair', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.sourceLanguage]: 'en', [SETTINGS_KEYS.targetLanguage]: 'bn' },
    fetch: url => (url.includes(TRANSLATION)
      ? jsonResponse({ 'destination-text': 'হাতুড়ি' })
      : undefined)
  });

  await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });
  const second = await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });

  assert.deepEqual(second.data, { translations: ['হাতুড়ি'] });
  assert.equal(background.requestedUrls.length, 1);
  assert.equal(
    new URL(background.requestedUrls[0]).searchParams.get('sl'),
    'en',
    'an explicit source language is sent'
  );
});

test('Translations are refused when the feature is off', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.enableTranslations]: false }
  });

  const response = await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });

  assert.deepEqual(response, {
    success: false,
    error: 'Translations are turned off in settings'
  });
  assert.deepEqual(background.requestedUrls, []);
});

test('Definitions are refused when the feature is off', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.enableDefinitions]: false }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.error, 'Definitions are turned off in settings');
  assert.deepEqual(background.requestedUrls, []);
});

test('Definitions are refused when the source language is not English', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.sourceLanguage]: 'bn' }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.error, 'Definitions are only available for English words');
  assert.deepEqual(background.requestedUrls, []);
});

test('clearing the cache makes the next Lookup request again', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  const cleared = await background.send({ type: 'CLEAR_CACHE' });
  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.deepEqual(cleared, { success: true });
  assert.equal(background.networkUrls.length, 2);
});

test('clearing the translation cache leaves definitions cached', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryEntry('hammer');
      if (url.includes(TRANSLATION)) return jsonResponse({ 'destination-text': 'হাতুড়ি' });
      return undefined;
    }
  });

  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });
  await background.send({ type: 'CLEAR_TRANSLATION_CACHE' });
  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  await background.send({ type: 'GET_TRANSLATION', text: 'hammer' });

  assert.equal(
    background.requestedUrls.filter(url => url.includes(DICTIONARY)).length,
    1,
    'the definition stayed cached'
  );
  assert.equal(
    background.requestedUrls.filter(url => url.includes(TRANSLATION)).length,
    2,
    'the translation was refetched'
  );
});

test('an unknown message type is reported, not thrown', async () => {
  const background = createBackground({});

  const response = await background.send({ type: 'NOT_A_REAL_TYPE' });

  assert.deepEqual(response, { success: false, error: 'Unknown message type' });
});

// --- Headword eligibility ------------------------------------------------

test('a single-word selection is accepted', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: '  hammer  ' });

  assert.equal(response.success, true);
  assert.equal(background.networkUrls.length, 1);
});

test('a multi-word selection is rejected without issuing a request', async () => {
  const background = createBackground({});

  const response = await background.send({
    type: 'GET_DEFINITION',
    word: 'claw hammer'
  });

  assert.equal(response.success, false);
  assert.equal(response.error, 'Please select a valid word to look up');
  assert.deepEqual(background.requestedUrls, [], 'no request may be issued');
});

test('a non-English headword is still looked up', async () => {
  // The reader selects the word on the page they are reading, so the trigger
  // fires for a non-Latin word too. A predicate that only accepted [a-z] would
  // reject it here, before any provider had a chance to answer.
  const background = createBackground({
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('জল') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'জল' });

  assert.equal(response.success, true);
  assert.deepEqual(background.networkUrls, [
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent('জল')}`
  ]);
});

test('a selection with no letter in it is rejected without issuing a request', async () => {
  const background = createBackground({});

  const response = await background.send({ type: 'GET_DEFINITION', word: '42' });

  assert.equal(response.success, false);
  assert.deepEqual(background.requestedUrls, []);
});

test('an implausibly long selection is rejected without issuing a request', async () => {
  // No whitespace, so nothing but a length bound stops this becoming a very
  // long provider URL.
  const background = createBackground({});

  const response = await background.send({ type: 'GET_DEFINITION', word: 'a'.repeat(5_000) });

  assert.equal(response.success, false);
  assert.equal(response.error, 'Please select a valid word to look up');
  assert.deepEqual(background.requestedUrls, []);
});

test('a multi-word selection is rejected whatever the whitespace looks like', async () => {
  const selections = [
    'claw hammer',
    'claw\thammer',
    'claw\nhammer',
    'claw  hammer',
    'ham mers',
    'the quick brown fox'
  ];

  for (const selection of selections) {
    const background = createBackground({});
    const response = await background.send({ type: 'GET_DEFINITION', word: selection });

    assert.equal(response.success, false, `${JSON.stringify(selection)} was accepted`);
    assert.equal(response.error, 'Please select a valid word to look up');
    assert.deepEqual(background.requestedUrls, []);
  }
});

test('a single-word selection with no entry is still asked for', async () => {
  // The distinction from the case above: a rare single word is a not-found, and
  // it must reach the provider, because the bundle missing is the design.
  const background = createBackground({
    fetch: url => (url.includes(DICTIONARY) ? notFound() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.equal(response.error, 'Definition not found');
  assert.equal(background.networkUrls.length, 1);
});

// --- The bundled dictionary -----------------------------------------------

// The dictionary that ships in the package. Most tests here read the committed
// artefact, because the claim under test is that a word a reader actually looks
// up resolves from what is shipped. The ones that need a shape the artefact
// happens not to contain pass their own.

// The meta block a fixture needs. The reader ignores it, so it only has to be
// the shape the generator writes.
const META = { buildDate: '2026-01-01' };

// A headword the artefact carries, chosen because its first Sense carries a
// Definition, an Example, Synonyms and Antonyms: the four Fields #16 is about.
const SENSES = {
  meta: META,
  entries: {
    happy: [
      {
        pos: 'adj',
        definitions: ['Having a feeling arising from well-being or enjoyment.'],
        examples: ['Music makes me feel happy.'],
        synonyms: ['cheerful', 'content', 'delighted', 'elated'],
        antonyms: ['blue', 'depressed', 'down', 'miserable']
      },
      {
        pos: 'adj',
        definitions: ['Experiencing the effect of favourable fortune.'],
        examples: ['a happy coincidence'],
        synonyms: ['fortunate', 'lucky'],
        antonyms: ['unlucky']
      }
    ]
  }
};

test('a common English word resolves all four Fields with no network request', async () => {
  const background = createBackground({
    fetch: () => {
      throw new Error('the bundle answers a common word, so no provider may be reached');
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.deepEqual(background.networkUrls, []);
  assert.ok(response.data.defs.length > 0, 'a Definition');
  assert.ok(response.data.defs.some(d => d.example), 'an Example');
  assert.ok(response.data.synonyms.length > 0, 'a Synonym');
  assert.ok(response.data.antonyms.length > 0, 'an Antonym');
  // Every Definition is the Sense's own wording, carrying its part of speech,
  // rather than a sentence about the headword assembled by the background.
  assert.ok(response.data.defs.every(d => d.definition && d.partOfSpeech));
  assert.equal(response.data.audio, '', 'the bundle carries no audio');
});

test('the bundle is read once and held, so a repeated Lookup costs nothing', async () => {
  // Two shapes of repeat, because they fail differently. Sequential Lookups
  // need the result memoised; concurrent ones need the *promise* shared, or a
  // reader gets three simultaneous inflations of the same 5 MB file.
  const background = createBackground({ fetch: () => notFound() });

  const first = await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  const second = await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  await Promise.all([
    background.send({ type: 'GET_DEFINITION', word: 'happy' }),
    background.send({ type: 'GET_DEFINITION', word: 'happy' })
  ]);

  assert.deepEqual(second.data, first.data);
  assert.deepEqual(background.networkUrls, [], 'no repeat reaches a provider');
  assert.deepEqual(
    background.requestedUrls,
    [background.bundleUrl],
    'the packaged dictionary is read once, and shared while in flight'
  );
});

test('a headword the bundle does not carry reaches the live provider', async () => {
  const background = createBackground({
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('xylophone') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.equal(response.success, true);
  assert.deepEqual(background.networkUrls, [
    'https://api.dictionaryapi.dev/api/v2/entries/en/xylophone'
  ]);
  assert.equal(response.data.defs[0].definition, 'A thing made or used for a particular purpose.');
});

test('a bundled word is answered in any case, from one entry', async () => {
  const background = createBackground({ fetch: () => notFound() });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'HaPpY' });

  assert.equal(response.success, true);
  assert.deepEqual(background.networkUrls, []);
  assert.ok(response.data.defs.length > 0);
});

test('the packaged dictionary is read rather than requested from a provider', async () => {
  const background = createBackground({});

  await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  // A relative path, which resolves against the extension's own document. An
  // absolute moz-extension:// URL would work too, but this is the form that
  // works identically in the test harness and needs no runtime.getURL.
  assert.equal(background.bundleUrl, 'data/wordglance-en-dictionary.json.gz');
  assert.ok(background.bundleUrl.startsWith('data/'), 'it ships inside the package');
});

test('a Lookup is refused before the bundle is read when the selection is a phrase', async () => {
  // Reading 5 MB for a selection that can never be a Lookup would be the
  // expensive version of the same refusal, so the rejection comes first.
  const background = createBackground({ fetch: () => notFound() });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy as a lark' });

  assert.equal(response.success, false);
  assert.deepEqual(background.requestedUrls, [], 'nothing is read and nothing is requested');
});

test('the bundle answers before the persisted cache', async () => {
  // A word the bundle carries may also be sitting in the cache from an earlier
  // session, holding a provider's answer. The bundle is the data this extension
  // is built around, so it is the one that answers.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('happy') : undefined)
  });
  await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  await background.send({ type: 'CLEAR_CACHE' });

  const withBundle = createBackground({
    storage: { 'wordglance-cache-definitions': JSON.stringify({ happy: { defs: [], synonyms: [], antonyms: [], audio: 'cached' } }) },
    fetch: () => notFound()
  });

  const response = await withBundle.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.ok(response.data.defs.length > 0, 'the bundled Senses answered');
  assert.deepEqual(withBundle.networkUrls, []);
});

test('a bundled Lookup does not write to the persisted cache', async () => {
  // The cache exists to stop a request being made. A bundled Lookup makes none,
  // so writing it grows extension storage for no saving, and it would put a
  // second copy of the artefact's words where a reader can clear it and get the
  // provider's answer back.
  const background = createBackground({ fetch: () => notFound() });

  await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(background.storage.data['wordglance-cache-definitions'], undefined);
});

test('a packaged dictionary that cannot be read falls through to the provider', async () => {
  // A missing or corrupt artefact is a packaging fault, not a Lookup fault. The
  // extension answers from the provider rather than failing every Definition,
  // which is what a reader would see if the file were not in the XPI.
  const background = createBackground({
    dictionary: false,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('happy') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.equal(response.data.defs[0].definition, 'A thing made or used for a particular purpose.');
  assert.equal(background.networkUrls.length, 1);
});

test('a corrupt packaged dictionary falls through to the provider', async () => {
  const background = createBackground({
    dictionary: 'not the shape the generator writes',
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('happy') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.equal(background.networkUrls.length, 1);
});

test('a failed packaged read is not retried, because it cannot succeed later', async () => {
  // Every way a packaged read fails is permanent - the file is not there, the
  // gzip is truncated, the JSON is the wrong shape - and none of them change
  // while the browser runs. Re-inflating 5 MB per Lookup to get the same answer
  // is the expensive way to be sure.
  const background = createBackground({
    dictionary: false,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('happy') : undefined)
  });

  await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  await background.send({ type: 'GET_DEFINITION', word: 'walked' });

  assert.equal(
    background.requestedUrls.filter(url => url === background.bundleUrl).length,
    1,
    'the packaged file is attempted once'
  );
});

test('Synonyms and Antonyms are the Senses own, in dictionary order', async () => {
  const background = createBackground({
    dictionary: SENSES,
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  // Both Senses' relations, in the order the reader meets them, deduplicated.
  // Not the first Sense alone, not sorted, and not an entry-level list - the
  // artefact has no such list, which is what makes the flattening ADR-0002
  // forbids impossible here rather than merely avoided.
  assert.deepEqual(response.data.synonyms, ['cheerful', 'content', 'delighted', 'elated', 'fortunate', 'lucky']);
  assert.deepEqual(response.data.antonyms, ['blue', 'depressed', 'down', 'miserable', 'unlucky']);
  assert.deepEqual(response.data.defs, [
    {
      partOfSpeech: 'adjective',
      definition: 'Having a feeling arising from well-being or enjoyment.',
      example: 'Music makes me feel happy.'
    },
    {
      partOfSpeech: 'adjective',
      definition: 'Experiencing the effect of favourable fortune.',
      example: 'a happy coincidence'
    }
  ]);
});

test('a part of speech is spelled out rather than passed through as a tag', async () => {
  // The Tooltip prints the part of speech on its own line, and the provider
  // path spells it out. "adj" on screen where the reader had "adjective" before
  // is a visible difference, and #16 asks for the Tooltip to be unchanged.
  const background = createBackground({
    dictionary: {
      meta: META,
      entries: {
        happy: [
          { pos: 'adj', definitions: ['Feeling well-being.'], examples: [], synonyms: [], antonyms: [] },
          { pos: 'prep_phrase', definitions: ['A prepositional phrase.'], examples: [], synonyms: [], antonyms: [] },
          { pos: 'intj', definitions: ['An interjection.'], examples: [], synonyms: [], antonyms: [] }
        ]
      }
    },
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.deepEqual(
    response.data.defs.map(d => d.partOfSpeech),
    ['adjective', 'prepositional phrase', 'interjection']
  );
});

test('a part of speech the map does not carry falls through to the tag', async () => {
  // A refresh introducing a tag must show the reader something. Rendering
  // nothing would read as a Definition with no part of speech at all, which is
  // a different thing from a tag nobody has a name for yet.
  const background = createBackground({
    dictionary: {
      meta: META,
      entries: {
        happy: [{ pos: 'ideophone', definitions: ['A sound of assent.'], examples: [], synonyms: [], antonyms: [] }]
      }
    },
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.data.defs[0].partOfSpeech, 'ideophone');
});

test('a multi-word Synonym or Antonym is filtered out', async () => {
  // "happy as a lark" is not a word, and trimming it to "happy" would assert a
  // synonym the source did not. It is filtered rather than shortened.
  const background = createBackground({
    dictionary: {
      meta: META,
      entries: {
        happy: [{
          pos: 'adj',
          definitions: ['Having a feeling arising from well-being.'],
          examples: [],
          synonyms: ['happy as a lark', 'cheerful', 'in\ngood spirits', 'elated'],
          antonyms: ['down in the dumps', 'blue']
        }]
      }
    },
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.deepEqual(response.data.synonyms, ['cheerful', 'elated']);
  assert.deepEqual(response.data.antonyms, ['blue']);
});

test('duplicate relations are removed and the lists are capped', async () => {
  const background = createBackground({
    dictionary: {
      meta: META,
      entries: {
        happy: Array.from({ length: 8 }, (_, i) => ({
          pos: 'adj',
          definitions: [`Sense ${i}.`],
          examples: [],
          // Every Sense repeats the first three, so a list built by appending
          // without deduplicating would show the same word nine times.
          synonyms: ['shared', 'also-shared', `unique${i}`, 'shared'],
          antonyms: ['opposed', 'also-opposed', `reverse${i}`, 'opposed']
        }))
      }
    },
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.deepEqual(response.data.synonyms, [
    'shared', 'also-shared', 'unique0', 'unique1', 'unique2', 'unique3'
  ]);
  assert.deepEqual(response.data.antonyms, [
    'opposed', 'also-opposed', 'reverse0', 'reverse1', 'reverse2', 'reverse3'
  ]);
  assert.equal(response.data.defs.length, 8, 'all eight Senses are returned');
});

test('a Sense with no Example still resolves its Definition', async () => {
  // CONTEXT.md: a Field may be empty, and empty is a normal outcome rather than
  // a failure. A headword whose Senses carry no Examples must not lose them.
  const background = createBackground({
    dictionary: {
      meta: META,
      entries: {
        happy: [
          { pos: 'adj', definitions: ['One meaning.'], examples: [], synonyms: [], antonyms: [] },
          { pos: 'noun', definitions: ['Another meaning.'], examples: ['An example.'], synonyms: [], antonyms: [] }
        ]
      }
    },
    fetch: () => notFound()
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.deepEqual(response.data.defs, [
    { partOfSpeech: 'adjective', definition: 'One meaning.', example: '' },
    { partOfSpeech: 'noun', definition: 'Another meaning.', example: 'An example.' }
  ]);
});

test('an entry with no Senses falls through to the provider', async () => {
  // The generator drops a headword it cannot answer, so this cannot arise from
  // a real artefact. Treating it as a miss rather than an empty Lookup is what
  // keeps a defect in the data from becoming a word with no Definition at all.
  const background = createBackground({
    dictionary: { meta: META, entries: { happy: [] } },
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('happy') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.data.defs[0].definition, 'A thing made or used for a particular purpose.');
  assert.equal(background.networkUrls.length, 1);
});

test('a bundled Lookup is still refused when Definitions are turned off', async () => {
  // The bundle is an answer to a Definition Lookup, not a bypass of the
  // reader's settings.
  const background = createBackground({
    storage: { 'wordglance-enable-definitions': false }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.error, 'Definitions are turned off in settings');
  assert.deepEqual(background.requestedUrls, []);
});

test('a bundled Lookup is still refused when the Source language is not English', async () => {
  // The bundle is English, so a reader who asked for Bengali Definitions has
  // not been answered by it. Non-English Definitions are issue #18.
  const background = createBackground({
    storage: { 'wordglance-source-language': 'bn' }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.error, 'Definitions are only available for English words');
  assert.deepEqual(background.requestedUrls, []);
});

test('a Translation Lookup does not read the dictionary', async () => {
  // The bundle answers Definitions. A reader who only ever translates should
  // never pay for 5 MB of it, which is what loading it lazily is for.
  const background = createBackground({
    fetch: url => (url.includes(TRANSLATION)
      ? jsonResponse({ 'destination-text': 'খুশি' })
      : undefined)
  });

  await background.send({ type: 'GET_TRANSLATION', text: 'happy' });

  assert.deepEqual(background.requestedUrls.length, 1);
  assert.ok(!background.requestedUrls.includes(background.bundleUrl));
});

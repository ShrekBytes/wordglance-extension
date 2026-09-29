/*
  Behaviour of the background script, driven through its real message contract.

  Every test here sends a message the content script would send and asserts on
  the payload that comes back and on the URLs the background asked for. No test
  calls a function the background defines internally, so a provider can be
  swapped for an equivalent one without breaking these.
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

// --- Current behaviour ---------------------------------------------------

test('a single-word Lookup returns Definitions, Synonyms, Antonyms and audio', async () => {
  const background = createBackground({
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
  assert.deepEqual(background.requestedUrls, [
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
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  const first = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  const second = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(first.success, true);
  assert.deepEqual(second.data, first.data);
  assert.equal(background.requestedUrls.length, 1);
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
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  const cleared = await background.send({ type: 'CLEAR_CACHE' });
  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.deepEqual(cleared, { success: true });
  assert.equal(background.requestedUrls.length, 2);
});

test('clearing the translation cache leaves definitions cached', async () => {
  const background = createBackground({
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
    fetch: url => (url.includes(DICTIONARY) ? dictionaryEntry('hammer') : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: '  hammer  ' });

  assert.equal(response.success, true);
  assert.equal(background.requestedUrls.length, 1);
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
  assert.deepEqual(background.requestedUrls, [
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
  assert.equal(background.requestedUrls.length, 1);
});

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

const { createBackground, jsonResponse, notFound, unreadableBody, wikiPage } = require('./harness');

const DICTIONARY = 'freedictionaryapi.com';
const THESAURUS = 'api.datamuse.com';
const WIKTIONARY = 'en.wiktionary.org';

const SETTINGS_KEYS = {
  enableDefinitions: 'wordglance-enable-definitions',
  enableTranslations: 'wordglance-enable-translations',
  sourceLanguage: 'wordglance-source-language',
  targetLanguage: 'wordglance-target-language'
};

// --- The live dictionary provider ------------------------------------------

// A response from the live provider, in the shape it serves: the word asked
// about, the Entries it has for it, and the source the data came from with the
// licence it may be used under. The licence travels with every response; the
// credit it obliges is static text in the settings, so nothing reads it here.
const dictionaryResponse = (word, entries) => jsonResponse({
  word,
  entries: entries || [],
  source: {
    url: `https://en.wiktionary.org/wiki/${word}`,
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }
  }
});

// One Entry: the part of speech its Senses share, and the relations of the
// headword as a whole. The Entry's own synonym and antonym lists are never
// surfaced - ADR-0002 forbids it - so a fixture that needs them passes them in
// `overrides` deliberately.
const dictionaryEntry = (partOfSpeech, senses, overrides) => ({
  language: { code: 'en', name: 'English' },
  partOfSpeech,
  pronunciations: [],
  forms: [],
  senses: senses || [],
  synonyms: [],
  antonyms: [],
  ...overrides
});

// One Sense, reduced to what the Tooltip reads. Its Examples, Synonyms and
// Antonyms belong to this Sense rather than to the headword.
const dictionarySense = (definition, overrides) => ({
  definition,
  tags: [],
  examples: [],
  quotes: [],
  synonyms: [],
  antonyms: [],
  subsenses: [],
  ...overrides
});

// The provider has a headword, and its first Sense carries all four Fields.
const HAS_HAMMER = () => dictionaryResponse('hammer', [
  dictionaryEntry('noun', [
    dictionarySense('A tool with a heavy head and a handle used for pounding.', {
      examples: ['She packed her tools.'],
      synonyms: ['instrument', 'utensil'],
      antonyms: ['person']
    })
  ])
]);

// A headword outside the bundle's cut-off, which the provider has a Definition
// for and no relations for. That is the headword the thesaurus is there for.
const HAS_XYLOPHONE = () => dictionaryResponse('xylophone', [
  dictionaryEntry('noun', [
    dictionarySense('A musical instrument of graduated wooden slats.', {
      examples: ['She plays the xylophone.']
    })
  ])
]);

// A Bengali headword, which the provider answers in Bengali: this is what
// makes a Definition in the reader's own language possible at all.
const BN_JOL = () => dictionaryResponse('জল', [
  dictionaryEntry('noun', [
    dictionarySense('পানি', {
      examples: ['এক গ্লাস জল খান।'],
      synonyms: ['বারি', 'সলিল'],
      antonyms: []
    }),
    dictionarySense('জলের রস', { examples: [], synonyms: ['রস'], antonyms: [] })
  ], { language: { code: 'bn', name: 'Bengali' } })
]);

// The thesaurus's answer for one relation: the words it found, ranked.
const thesaurusWords = (...words) => jsonResponse(words.map(word => ({ word, score: 1000 })));

// Which relation a thesaurus request is asking for. The two relations are two
// requests, and asking for both at once would be one constraint, not two.
const relationOf = url => new URL(url).searchParams.get('rel_syn') ? 'rel_syn' : 'rel_ant';

// The bundled dictionary is empty for every test in this section: each is about
// the live provider, and a headword the bundle happens to carry would answer
// from the package before the provider was ever reached. The bundle is covered
// on its own terms below.
const NO_BUNDLE = { dictionary: {} };

// --- The Wiktionary page ---------------------------------------------------

// A Wiktionary page reduced to the parts a reader sees. The page is read as raw
// markup, so this is markup: a headword's English section, its Pronunciation
// block and a Translations block per Sense, followed by a Danish section that
// must never be read for an English headword.
//
// The Danish section deliberately lists a Bengali equivalent and a Danish
// recording of the same word, so scoping to the headword's own language is
// proved wherever these fixtures are used rather than taken on trust.
//
// `multitrans` wraps a block in the {{multitrans}} form, which carries the same
// information in the shape a modern page uses.
function wiktionaryPage({ pronunciation = '', rows = [], moreRows = [], multitrans = false } = {}) {
  const block = lines => [
    '{{trans-top|tool}}',
    ...(multitrans ? ['{{multitrans|data=', ...lines, '}}'] : lines),
    '{{trans-bottom}}'
  ];

  return [
    '==English==',
    '',
    '===Pronunciation===',
    pronunciation,
    '',
    '===Noun===',
    '{{en-noun}}',
    '# A [[tool]] with a heavy [[head]] and a [[handle]].',
    '#: {{ux|en|Bobby used a hammer and nails.}}',
    '',
    '====Translations====',
    ...block(rows),
    '',
    '===Verb===',
    '# To strike repeatedly.',
    '',
    '====Translations====',
    ...block(moreRows),
    '',
    '==Danish==',
    '',
    '===Pronunciation===',
    '* {{audio|da|Da-hammer.ogg}}',
    '',
    '====Translations====',
    '{{trans-top|værktøj}}',
    '* Bengali: {{t+|bn|হাতুড়ি}}',
    '{{trans-bottom}}',
    ''
  ].join('\n');
}

// A Translation lookup costs one request, and it is to this page.
const wiktionaryFetch = (markup, status = 200) => url => (
  url.includes(WIKTIONARY) ? wikiPage(markup, status) : undefined
);

const BENGALI_ROW = '* Bengali: {{t+|bn|হাতুড়ি}}, {{t|bn|মারিবল}}';

// Most of these tests are about a reader who chose Bangla, and the default Target
// language is English.
const READS_BENGLA = { storage: { [SETTINGS_KEYS.targetLanguage]: 'bn' } };

// --- Current behaviour ---------------------------------------------------

test('a single-word Lookup returns Definitions, Synonyms and Antonyms', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'Hammer' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, {
    defs: [
      {
        definition: 'A tool with a heavy head and a handle used for pounding.',
        partOfSpeech: 'noun',
        example: 'She packed her tools.'
      }
    ],
    synonyms: ['instrument', 'utensil'],
    antonyms: ['person'],
    // The provider serves pronunciation as a phonetic transcription and carries
    // no recording, so this Field is empty. A recording comes off the Wiktionary
    // page the Translation Field is read from.
    audio: ''
  });
  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/en/hammer'
  ]);
});

test('Definitions and Examples are capped at the configured limits', async () => {
  const senses = Array.from({ length: 12 }, (_, i) => dictionarySense(`Meaning ${i}.`, {
    examples: [`Example ${i}.`],
    synonyms: Array.from({ length: 10 }, (__, j) => `syn${i}-${j}`),
    antonyms: Array.from({ length: 10 }, (__, j) => `ant${i}-${j}`)
  }));

  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryResponse('tool', [
      dictionaryEntry('noun', senses)
    ]) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'tool' });

  assert.equal(response.data.defs.length, 9);
  assert.equal(response.data.synonyms.length, 6);
  assert.equal(response.data.antonyms.length, 6);
});

test('a repeated Lookup of the same word issues no further request', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  const first = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  const second = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(first.success, true);
  assert.deepEqual(second.data, first.data);
  assert.equal(background.networkUrls.length, 1);
});

test('a word the provider has no entry for is a not-found, not a connection error', async () => {
  // The provider signals an unknown word with a successful response carrying no
  // entries rather than with a 404, which is why an empty answer is read as this
  // word having no entry and not as a failure: the two are different facts, and
  // a reader told the network is down when it is up is worse off than one told
  // nothing.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryResponse('zzzqqq', []);
      if (url.includes(THESAURUS)) return thesaurusWords();
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.deepEqual(response, { success: false, error: 'Definition not found' });
  assert.notEqual(
    response.error,
    'Connection error - please try again',
    'the two must not collapse into one message'
  );
});

test('a 404 from the provider is the same not-found', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return notFound();
      if (url.includes(THESAURUS)) return thesaurusWords();
      return undefined;
    }
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
  assert.deepEqual(background.networkUrls.length, 1, 'a failure ends the Lookup there');
});

test('a server failure is a connection error, not a not-found', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? jsonResponse({ error: 'boom' }, 500) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.error, 'Connection error - please try again');
});

test('a response the extension cannot read is a connection error', async () => {
  // An outage page served with a healthy status is a request that returned
  // nothing usable, and reporting it as a not-found would tell a reader their
  // word has no entry when the extension never got to ask.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? unreadableBody() : undefined)
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

test('a Translation Lookup lists every equivalent for the Target language', async () => {
  // Several alternatives inside one language is the requirement, not a nicety:
  // a reader often has to choose between the formal and the colloquial word.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({ rows: [BENGALI_ROW] }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'Hammer' });

  assert.deepEqual(response, {
    success: true,
    data: { translations: ['হাতুড়ি', 'মারিবল'], audio: '' }
  });
  assert.equal(background.networkUrls.length, 1, 'one page, one request');
  assert.equal(
    new URL(background.networkUrls[0]).searchParams.get('title'),
    'hammer',
    'the headword, in the case the reader selected it in'
  );
});

test('equivalents come back in page order, and only the English section is read', async () => {
  // Page order is the reader's order, so nothing here sorts or regroups. The
  // Danish section at the foot of the fixture lists the same Bengali equivalent
  // and a Danish recording, and neither may reach an English headword's Lookup:
  // a Bengali equivalent of the Danish word is not a Bengali equivalent of the
  // English one.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: ['* Afrikaans: {{t+|af|hamer}}', BENGALI_ROW, '* German: {{t+|de|Hammer}}'],
      moreRows: ['* Bengali: {{t+|bn|কুলাহাড়ি}}']
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data.translations, ['হাতুড়ি', 'মারিবল', 'কুলাহাড়ি']);
  assert.equal(response.data.audio, '', 'the Danish recording is not the headword’s');
});

test('the equivalents of a modern page are read out of its multitrans block', async () => {
  // Two shapes carry the same information on Wiktionary today, and a page uses
  // whichever its editor did. Both have to read, or most headwords quietly come
  // back with no Translation at all.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: ['* Afrikaans: {{t+|af|hamer}}', BENGALI_ROW],
      multitrans: true
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data.translations, ['হাতুড়ি', 'মারিবল']);
});

test('an equivalent repeated across a headword’s Senses is listed once', async () => {
  // A word has a Translations block per Sense, and a reader looking at a
  // formal-versus-colloquial choice is not helped by the same word twice. The
  // first mention is the one kept, so page order still reads true.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: [BENGALI_ROW],
      moreRows: [BENGALI_ROW, '* Bengali: {{t+|bn|কুলাহাড়ি}}']
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data.translations, ['হাতুড়ি', 'মারিবল', 'কুলাহাড়ি']);
});

test('equivalents are capped at the configured limit', async () => {
  // A reader gets several alternatives to choose between, not a wall of them.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: [Array.from(
        { length: 12 },
        (_, i) => `* Bengali: {{t+|bn|হাতুড়ি${i}}}`
      ).join('\n')]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(response.data.translations.length, 8);
  assert.equal(response.data.translations[0], 'হাতুড়ি0', 'page order survives the cap');
});

test('a dialect’s equivalents are not the language’s', async () => {
  // A page nests a dialect below the language it is a dialect of, in a row of
  // its own. Those rows are not the Target language's equivalents - a reader
  // reading Arabic is reading Arabic, not a variety of it.
  const background = createBackground({
    storage: { [SETTINGS_KEYS.targetLanguage]: 'ar' },
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: [
        '* Arabic: {{tt+|ar|مِطْرَقَة|f}}, {{tt|ar|شَاكُوش|m}}',
        '*: Egyptian Arabic: {{tt|arz|شَاكُوش|m|tr=šakūš}}',
        '*: Algerian Arabic: {{tt|arq|مطرقة|f}}'
      ]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data.translations, ['مِطْرَقَة', 'شَاكُوش']);
});

test('an equivalent the page writes as a link is shown as the word, not the markup', async () => {
  // A page spells a word as a link whenever that word is also a page of its own,
  // which is most of them. Two things go wrong if the markup reaches the reader:
  // they are shown `[[bəxt|bəxti]]`, and the link's own `|` reads as the
  // separator between the template's arguments, so the word arrives truncated to
  // `[[bəxt`.
  const background = createBackground({
    storage: { [SETTINGS_KEYS.targetLanguage]: 'az' },
    fetch: wiktionaryFetch(wiktionaryPage({
      rows: ['* Azerbaijani: {{t|az|[[bəxt|bəxti]] [[gətirən]]}}, {{t+|az|[[şən]]}} {{q|colloquial}}']
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'happy' });

  assert.deepEqual(response.data.translations, ['bəxti gətirən', 'şən']);
});

test('a headword with no equivalents for the Target language yields an empty Translation', async () => {
  // A Field may be empty, and empty is a normal outcome rather than a failure.
  // The reader is told the absence is real and keeps the Definition they came
  // for. The Danish section's Bengali row must not stand in for the English
  // headword's, so this is empty rather than one word.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({ rows: ['* German: {{t+|de|Hammer}}'] }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, { translations: [], audio: '' });
});

test('a headword Wiktionary has no page for yields an empty Translation', async () => {
  // The page not being there and the page not having the word are the same
  // answer for the reader: there is no equivalent in the Target language. It
  // is not a connection failure, and it must not be reported as one.
  const background = createBackground({ fetch: wiktionaryFetch('not a page', 404) });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'xylophone' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, { translations: [], audio: '' });
  assert.equal(background.networkUrls.length, 1);
});

test('a repeated Translation Lookup issues no further request', async () => {
  // The cache is keyed by the Target language as well as the headword, because
  // both Fields read out of the page follow from it. The settings popup clears
  // this cache when the reader changes it, so a stale answer cannot outlive the
  // setting that produced it.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({ rows: [BENGALI_ROW] }))
  });

  const first = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });
  const second = await background.send({ type: 'GET_TRANSLATION', word: 'Hammer' });

  assert.deepEqual(second.data, first.data);
  assert.equal(background.networkUrls.length, 1);
});

test('the Translation Field is suppressed when Source is set to the Target language', async () => {
  // The headword is already in the language the reader asked to read it in, so
  // there is nothing to translate it into. Decided here rather than asked of
  // Wiktionary, so the answer is the same whichever provider is behind it, and
  // so a Lookup in this state costs no request at all.
  const background = createBackground({
    storage: {
      [SETTINGS_KEYS.sourceLanguage]: 'bn',
      [SETTINGS_KEYS.targetLanguage]: 'bn'
    },
    fetch: url => {
      throw new Error('nothing may be requested when the Field is suppressed');
    }
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'জল' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, { translations: [], audio: '' });
  assert.deepEqual(background.requestedUrls, []);
});

test('an auto-detected Source language is not the Target language', async () => {
  // 'auto' is a setting, not a language, so it can never be equal to the Target
  // language the reader chose - and treating it as such would suppress the Field
  // for the reader who never set a Source language at all.
  const background = createBackground({
    storage: { [SETTINGS_KEYS.sourceLanguage]: 'auto', [SETTINGS_KEYS.targetLanguage]: 'en' },
    fetch: wiktionaryFetch(wiktionaryPage({ rows: ['* English: {{t+|en|hammer}}'] }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data.translations, ['hammer']);
  assert.equal(background.networkUrls.length, 1);
});

test('Translations are refused when the feature is off', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.enableTranslations]: false }
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response, {
    success: false,
    error: 'Translations are turned off in settings'
  });
  assert.deepEqual(background.requestedUrls, []);
});

test('a Translation is refused for a multi-word selection without issuing a request', async () => {
  // A Lookup is about one headword. The Translation Field is a Field of that
  // Lookup, not a translation of whatever the reader happened to select, so a
  // phrase is refused here on the rule the Definition Field already uses.
  const background = createBackground({ fetch: wiktionaryFetch(wiktionaryPage({ rows: [BENGALI_ROW] })) });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'claw hammer' });

  assert.equal(response.success, false);
  assert.equal(response.error, 'Please select a valid word to look up');
  assert.deepEqual(background.requestedUrls, []);
});

test('a Wiktionary failure is a connection error, not an empty Translation', async () => {
  // The two must stay distinguishable. Reporting an outage as "no equivalents"
  // would tell a reader their word has none when the truth is that nothing was
  // asked.
  const background = createBackground({
    fetch: url => {
      if (url.includes(WIKTIONARY)) throw new Error('offline');
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response, {
    success: false,
    error: 'Connection error - please try again'
  });
});

test('a Translation Lookup does not read the dictionary', async () => {
  // The bundle answers Definitions. A reader who only ever translates should
  // never pay for 5 MB of it, which is what loading it lazily is for.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({ rows: [BENGALI_ROW] }))
  });

  await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(background.networkUrls.length, 1);
  assert.ok(!background.requestedUrls.includes(background.bundleUrl));
});

// --- Pronunciation --------------------------------------------------------

// The audio file names are read out of the same page as the equivalents, so a
// Lookup that shows a Translation costs no second request for a pronunciation.

test('a recording is read out of the same page as the equivalents', async () => {
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: '* {{IPA|en|/ˈhæmə/|a=RP}}\n** {{audio|en|En-uk-hammer.ogg|a=RP}}',
      rows: [BENGALI_ROW]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data, {
    translations: ['হাতুড়ি', 'মারিবল'],
    audio: 'https://commons.wikimedia.org/wiki/Special:FilePath/En-uk-hammer.ogg'
  });
  assert.equal(background.networkUrls.length, 1, 'the page served both Fields');
});

test('a headword with no equivalents still yields a pronunciation', async () => {
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: '* {{audio|en|En-us-hammer.ogg|a=US}}',
      rows: ['* German: {{t+|de|Hammer}}']
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.deepEqual(response.data, {
    translations: [],
    audio: 'https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hammer.ogg'
  });
});

test('a headword with no recording leaves the pronunciation empty', async () => {
  // Empty is what hides the pronounce control, which is this Field's documented
  // empty outcome rather than a broken one.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({ rows: [BENGALI_ROW] }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(response.data.audio, '');
});

test('a recording qualified with the Target language is preferred', async () => {
  // The second rung of the preference: among several recordings of one headword,
  // the one whose language matches what the reader reads, so the accent is
  // familiar.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: [
        '* {{audio|en|En-uk-hammer.ogg|a=SSB}}',
        '* {{audio|en|En-us-hammer.ogg|a=US}}',
        '* {{audio|bn|Bn-hammer.ogg}}'
      ].join('\n'),
      rows: [BENGALI_ROW]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(
    response.data.audio,
    'https://commons.wikimedia.org/wiki/Special:FilePath/Bn-hammer.ogg'
  );
});

test('an unqualified recording is preferred over one qualified with the Target language', async () => {
  // The first rung of the preference. A recording with no language of its own
  // is the headword's own pronunciation rather than one of a language's, so it
  // is what a reader gets when the page offers it.
  const background = createBackground({
    storage: { [SETTINGS_KEYS.targetLanguage]: 'en' },
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: [
        '* {{audio||hammer.ogg|Audio}}',
        '* {{audio|en|En-us-hammer.ogg|a=US}}'
      ].join('\n'),
      rows: [BENGALI_ROW]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(
    response.data.audio,
    'https://commons.wikimedia.org/wiki/Special:FilePath/hammer.ogg'
  );
});

test('the first recording stands when none matches the Target language', async () => {
  // The last rung: a reader is better served by an accent they do not recognise
  // than by no pronunciation at all.
  const background = createBackground({
    storage: { [SETTINGS_KEYS.targetLanguage]: 'fr' },
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: [
        '* {{audio|en|En-uk-hammer.ogg|a=SSB}}',
        '* {{audio|en|En-us-hammer.ogg|a=US}}'
      ].join('\n'),
      rows: [BENGALI_ROW]
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(
    response.data.audio,
    'https://commons.wikimedia.org/wiki/Special:FilePath/En-uk-hammer.ogg'
  );
});

test('a file name with spaces resolves to a playable Commons URL', async () => {
  // Reader-voice recordings carry spaces and brackets, and a URL built by
  // concatenation would 404 on the way to the file.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: '* {{audio|en|LL-Q1860 (eng)-Back ache-hammer.wav|a=UK}}'
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(
    response.data.audio,
    'https://commons.wikimedia.org/wiki/Special:FilePath/' +
      encodeURIComponent('LL-Q1860_(eng)-Back_ache-hammer.wav')
  );
});

test('an accent label is not mistaken for a recording', async () => {
  // `{{a|en|UK}}` is the shorthand for an accent heading and shares its name with
  // the shorthand for a recording. It names no file, so a reader must not be
  // offered one - the pronounce control has to be hidden, not broken.
  const background = createBackground({
    ...READS_BENGLA,
    fetch: wiktionaryFetch(wiktionaryPage({
      pronunciation: [
        '* {{a|en|UK}}',
        '** {{IPA|en|/ˈhæmə/|a=RP}}',
        '* {{a|en|GA}}',
        '** {{IPA|en|/ˈhæmɚ/|a=US}}'
      ].join('\n')
    }))
  });

  const response = await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(response.data.audio, '');
});

test('Definitions are refused when the feature is off', async () => {
  const background = createBackground({
    storage: { [SETTINGS_KEYS.enableDefinitions]: false }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.error, 'Definitions are turned off in settings');
  assert.deepEqual(background.requestedUrls, []);
});

test('clearing the cache makes the next Lookup request again', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
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
      if (url.includes(DICTIONARY)) return HAS_HAMMER();
      if (url.includes(WIKTIONARY)) {
        return wikiPage(wiktionaryPage({ rows: [BENGALI_ROW] }));
      }
      return undefined;
    }
  });

  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });
  await background.send({ type: 'CLEAR_TRANSLATION_CACHE' });
  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });
  await background.send({ type: 'GET_TRANSLATION', word: 'hammer' });

  assert.equal(
    background.networkUrls.filter(url => url.includes(DICTIONARY)).length,
    1,
    'the definition stayed cached'
  );
  assert.equal(
    background.networkUrls.filter(url => url.includes(WIKTIONARY)).length,
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
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
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
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'জল' });

  assert.equal(response.success, true);
  assert.deepEqual(background.networkUrls, [
    `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent('জল')}`
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
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryResponse('zzzqqq', []);
      if (url.includes(THESAURUS)) return thesaurusWords();
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.equal(response.error, 'Definition not found');
  assert.equal(background.networkUrls.length, 3, 'the provider, then both relations');
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
  // 'xylophone' is outside the bundle's cut-off, which is the whole point of
  // the provider: a word a reader actually looks up and the package cannot
  // answer must still be answered. Its Senses carry no relations, so the
  // thesaurus is asked as well - the two requests come after the provider's.
  const background = createBackground({
    fetch: url => (url.includes(DICTIONARY) ? HAS_XYLOPHONE() : thesaurusWords('marimba'))
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.equal(response.success, true);
  assert.deepEqual(
    background.networkUrls.filter(url => url.includes(DICTIONARY)),
    ['https://freedictionaryapi.com/api/v1/entries/en/xylophone']
  );
  assert.equal(response.data.defs[0].definition, 'A musical instrument of graduated wooden slats.');
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
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });
  await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  await background.send({ type: 'CLEAR_CACHE' });

  const withBundle = createBackground({
    storage: { 'wordglance-cache-definitions': JSON.stringify({ 'happy::en': { defs: [], synonyms: [], antonyms: [], audio: 'cached' } }) },
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
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.equal(response.data.defs[0].definition, 'A tool with a heavy head and a handle used for pounding.');
  assert.equal(background.networkUrls.length, 1);
});

test('a corrupt packaged dictionary falls through to the provider', async () => {
  const background = createBackground({
    dictionary: 'not the shape the generator writes',
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
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
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  await background.send({ type: 'GET_DEFINITION', word: 'happy' });
  await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

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
    fetch: url => (url.includes(DICTIONARY) ? HAS_HAMMER() : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.data.defs[0].definition, 'A tool with a heavy head and a handle used for pounding.');
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

// --- Coverage when the bundled dictionary misses ---------------------------

// The rest of the chain, hop by hop. The bundle is covered above; this is the
// live provider, the reader's own language, the thesaurus, and the Lookup every
// source comes up empty for. A broken middle hop ships silently, so each one is
// asserted on the Fields it answers and the requests it issues.

// A reader who has named their Source language. Non-English Definitions are the
// reason the message telling them Definitions were English-only is gone.
const READS_BENGLA_SOURCE = { storage: { [SETTINGS_KEYS.sourceLanguage]: 'bn' } };

// The provider's answer for the languages a headword is named in, and nothing
// for the rest - which is what a language the provider has no entry for looks
// like: a successful response carrying no entries.
const perLanguage = answers => url => {
  if (!url.includes(DICTIONARY)) return undefined;
  const language = url.split('/entries/')[1].split('/')[0];
  return answers[language] || dictionaryResponse('unknown', []);
};

test('a headword is asked of the provider in the reader’s Source language first', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    ...READS_BENGLA_SOURCE,
    fetch: perLanguage({ bn: BN_JOL() })
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'জল' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data.defs, [
    { definition: 'পানি', partOfSpeech: 'noun', example: 'এক গ্লাস জল খান।' },
    { definition: 'জলের রস', partOfSpeech: 'noun', example: '' }
  ]);
  assert.deepEqual(response.data.synonyms, ['বারি', 'সলিল', 'রস']);
  assert.deepEqual(background.networkUrls, [
    `https://freedictionaryapi.com/api/v1/entries/bn/${encodeURIComponent('জল')}`
  ]);
});

test('English answers when the reader’s Source language has no entry', async () => {
  // The fallback is what a reader gets rather than an error: they asked for a
  // Bengali Definition of a word Bengali does not define, and English is
  // something they can read.
  const background = createBackground({
    ...NO_BUNDLE,
    ...READS_BENGLA_SOURCE,
    fetch: perLanguage({ en: HAS_HAMMER() })
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.equal(response.success, true);
  assert.equal(response.data.defs[0].definition, 'A tool with a heavy head and a handle used for pounding.');
  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/bn/hammer',
    'https://freedictionaryapi.com/api/v1/entries/en/hammer'
  ]);
});

test('the bundle answers the English fallback, not the reader’s Source language', async () => {
  // The bundle holds English Senses, so it cannot answer a Bengali reader's
  // question about a Bengali word. It answers the English end of the chain,
  // which is what keeps a common word free for them too: one request, the one
  // that found nothing in their own language.
  const background = createBackground({
    ...READS_BENGLA_SOURCE,
    fetch: perLanguage({})
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.ok(response.data.defs.length > 0);
  assert.ok(response.data.synonyms.length > 0);
  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/bn/happy'
  ]);
});

test('an auto-detected Source language is answered in English, once', async () => {
  // 'auto' is a setting rather than a language, so it asks for English and
  // nothing else: the same Lookup a reader who set English gets.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: perLanguage({ en: HAS_HAMMER() })
  });

  await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/en/hammer'
  ]);
});

test('a cached answer in one Source language is not served for another', async () => {
  // The same headword is a different answer in the reader's Source language
  // than in English, so one language's cached answer cannot stand in for the
  // other's - a reader who changes their Source language would otherwise go on
  // reading the previous language's Definition of the word.
  const background = createBackground({
    ...NO_BUNDLE,
    ...READS_BENGLA_SOURCE,
    fetch: perLanguage({
      bn: BN_JOL(),
      hi: dictionaryResponse('जल', [dictionaryEntry('noun', [
        dictionarySense('जल', { examples: ['एक गिलास पानी पिएँ।'], synonyms: ['पानी'] })
      ], { language: { code: 'hi', name: 'Hindi' } })])
    })
  });

  const bengali = await background.send({ type: 'GET_DEFINITION', word: 'জল' });
  await background.change({ [SETTINGS_KEYS.sourceLanguage]: 'hi' });
  const hindi = await background.send({ type: 'GET_DEFINITION', word: 'জল' });

  assert.equal(bengali.data.defs[0].definition, 'পানি');
  assert.equal(hindi.data.defs[0].definition, 'जल');
  assert.deepEqual(background.networkUrls, [
    `https://freedictionaryapi.com/api/v1/entries/bn/${encodeURIComponent('জল')}`,
    `https://freedictionaryapi.com/api/v1/entries/hi/${encodeURIComponent('জল')}`
  ]);
});

test('an Entry’s own synonym and antonym lists are never surfaced', async () => {
  // The Entry's lists belong to the headword as a whole, which is a different
  // fact from any Sense's: they are unsorted dumps that mix words belonging to
  // different meanings, and a list of six is what a reader would be shown. The
  // two are made to differ sharply here, and the Senses' own are a single word
  // each - so an answer carrying the Entry's words could only have come from
  // the Entry.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryResponse('basin', [
      dictionaryEntry('noun', [
        dictionarySense('A wide bowl-shaped container.', { synonyms: ['dish'] }),
        dictionarySense('A hollow in the ground holding water.', { antonyms: ['slope'] })
      ], {
        synonyms: ['washbasin', 'font', 'lavatory', 'tureen', 'plate', 'bowl'],
        antonyms: ['mountain', 'ridge', 'summit', 'plateau', 'peak']
      })
    ]) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'basin' });

  assert.deepEqual(response.data.synonyms, ['dish']);
  assert.deepEqual(response.data.antonyms, ['slope']);
  assert.equal(background.networkUrls.length, 1, 'the thesaurus was not needed');
});

test('a sub-sense is a Definition of its own', async () => {
  // A Sense may carry sub-senses - a noun sense with one for each of its kinds
  // - and a sub-sense is as much a distinct meaning of the headword as its
  // parent is. Its Definition and its relations are the reader's.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryResponse('light', [
      dictionaryEntry('noun', [
        dictionarySense('A source of illumination.', {
          examples: ['Put that light out!'],
          subsenses: [
            dictionarySense('A lightbulb or similar light-emitting device.', {
              examples: ['We turned off all the lights.'],
              synonyms: ['bulb']
            })
          ]
        })
      ])
    ]) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'light' });

  assert.deepEqual(response.data.defs, [
    { definition: 'A source of illumination.', partOfSpeech: 'noun', example: 'Put that light out!' },
    { definition: 'A lightbulb or similar light-emitting device.', partOfSpeech: 'noun', example: 'We turned off all the lights.' }
  ]);
  assert.deepEqual(response.data.synonyms, ['bulb']);
});

test('a multi-word Synonym or Antonym from the provider is filtered out', async () => {
  // The same rule at this source as at the bundle's: a Synonym is a bare word,
  // and trimming a phrase to its first word would assert a synonym the source
  // did not.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => (url.includes(DICTIONARY) ? dictionaryResponse('happy', [
      dictionaryEntry('adjective', [
        dictionarySense('Feeling well-being.', {
          synonyms: ['happy as a lark', 'in\ngood spirits', 'cheerful'],
          antonyms: ['down in the dumps', 'blue']
        })
      ])
    ]) : undefined)
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.deepEqual(response.data.synonyms, ['cheerful']);
  assert.deepEqual(response.data.antonyms, ['blue']);
});

test('the thesaurus fills Synonyms and Antonyms when nothing else has them', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return HAS_XYLOPHONE();
      if (url.includes(THESAURUS)) {
        return relationOf(url) === 'rel_syn'
          ? thesaurusWords('marimba', 'glockenspiel')
          : thesaurusWords('hydraulophone');
      }
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.deepEqual(response.data, {
    defs: [{
      definition: 'A musical instrument of graduated wooden slats.',
      partOfSpeech: 'noun',
      example: 'She plays the xylophone.'
    }],
    synonyms: ['marimba', 'glockenspiel'],
    antonyms: ['hydraulophone'],
    audio: ''
  });
  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/en/xylophone',
    'https://api.datamuse.com/words?rel_syn=xylophone&max=6',
    'https://api.datamuse.com/words?rel_ant=xylophone&max=6'
  ]);
});

test('the thesaurus supplies relations and nothing else', async () => {
  // It has no Definitions and no Example sentences, so those two Fields can
  // only ever have come from the bundle or the provider - even though the
  // thesaurus was asked, and answered.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) {
        return dictionaryResponse('xylophone', [
          dictionaryEntry('noun', [
            dictionarySense('A musical instrument of graduated wooden slats.', {
              examples: ['She plays the xylophone.']
            }),
            dictionarySense('An instrument played by striking bars.', {
              examples: ['The glockenspiel glinted.']
            })
          ])
        ]);
      }
      if (url.includes(THESAURUS)) return thesaurusWords('marimba');
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.equal(response.data.defs.length, 2, 'the provider’s two Senses');
  assert.ok(response.data.defs.every(d => d.example), 'the provider’s Examples');
  assert.ok(response.data.defs.every(d => !d.definition.includes('marimba')));
});

test('the thesaurus is not consulted when the provider has relations', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return HAS_HAMMER();
      throw new Error('the thesaurus is only reached when nothing else has the Fields');
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'hammer' });

  assert.deepEqual(response.data.synonyms, ['instrument', 'utensil']);
  assert.deepEqual(response.data.antonyms, ['person']);
  assert.equal(background.networkUrls.length, 1);
});

test('the thesaurus is not consulted when the bundle answers', async () => {
  const background = createBackground({
    fetch: () => {
      throw new Error('the bundle answers a common word, so no provider may be reached');
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'happy' });

  assert.equal(response.success, true);
  assert.ok(response.data.synonyms.length > 0, 'the bundled Senses supplied the relations');
  assert.deepEqual(background.networkUrls, []);
});

test('a thesaurus failure leaves the relations empty rather than failing the Lookup', async () => {
  // The Definition and the Example have already resolved. A Field that could
  // not be filled is empty rather than fatal, which is the same rule the
  // Tooltip follows when one Field fails and the others stay visible - and the
  // reason a thesaurus outage does not take away the answer the reader came for.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return HAS_XYLOPHONE();
      if (url.includes(THESAURUS)) throw new Error('offline');
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.equal(response.success, true);
  assert.equal(response.data.defs.length, 1);
  assert.deepEqual(response.data.synonyms, []);
  assert.deepEqual(response.data.antonyms, []);
});

test('a thesaurus that answers one relation and fails the other keeps the one it has', async () => {
  // Two Fields and two requests: neither failure may take the other's answer
  // with it, or a reader who selected a word the thesaurus half knows loses the
  // half it does.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return HAS_XYLOPHONE();
      if (url.includes(THESAURUS)) {
        return relationOf(url) === 'rel_syn' ? thesaurusWords('marimba') : notFound();
      }
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data.synonyms, ['marimba']);
  assert.deepEqual(response.data.antonyms, []);
});

test('a multi-word expression from the thesaurus is filtered out', async () => {
  // Its vocabulary holds multiword expressions as well as words, so the same
  // rule applies here as at every other source: a Synonym is a bare word.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return HAS_XYLOPHONE();
      if (url.includes(THESAURUS)) return thesaurusWords('glockenspiel', 'vibraphone', 'one hand band');
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'xylophone' });

  assert.deepEqual(response.data.synonyms, ['glockenspiel', 'vibraphone']);
});

test('relations beside an empty Definition list when no source has the headword', async () => {
  // A piece of jargon or a product name: nothing defines it, but words related
  // to it exist, and a reader who selected it is better served by the words
  // around it than by nothing at all. The Tooltip prints its not-found for the
  // empty Definition Field beside them.
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryResponse('zzzqqq', []);
      if (url.includes(THESAURUS)) {
        return relationOf(url) === 'rel_syn' ? thesaurusWords('valley', 'dale') : thesaurusWords();
      }
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, {
    defs: [],
    synonyms: ['valley', 'dale'],
    antonyms: [],
    audio: ''
  });
});

test('the thesaurus’s answer is cached, so a repeated Lookup issues no further request', async () => {
  const background = createBackground({
    ...NO_BUNDLE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryResponse('zzzqqq', []);
      if (url.includes(THESAURUS)) return thesaurusWords('valley');
      return undefined;
    }
  });

  const first = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });
  const second = await background.send({ type: 'GET_DEFINITION', word: 'zzzqqq' });

  assert.deepEqual(second.data, first.data);
  assert.equal(background.networkUrls.length, 3, 'nothing was asked of anybody the second time');
});

test('every source is asked before a headword is reported not-found', async () => {
  // A not-found is only told once every source has been asked: reported early
  // it would be a claim about the word that no source had checked yet.
  const background = createBackground({
    ...NO_BUNDLE,
    ...READS_BENGLA_SOURCE,
    fetch: url => {
      if (url.includes(DICTIONARY)) return dictionaryResponse('cwm', []);
      if (url.includes(THESAURUS)) return thesaurusWords();
      return undefined;
    }
  });

  const response = await background.send({ type: 'GET_DEFINITION', word: 'cwm' });

  assert.deepEqual(response, { success: false, error: 'Definition not found' });
  assert.deepEqual(background.networkUrls, [
    'https://freedictionaryapi.com/api/v1/entries/bn/cwm',
    'https://freedictionaryapi.com/api/v1/entries/en/cwm',
    'https://api.datamuse.com/words?rel_syn=cwm&max=6',
    'https://api.datamuse.com/words?rel_ant=cwm&max=6'
  ]);
});

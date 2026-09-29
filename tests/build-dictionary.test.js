/*
  The dictionary generator's pruning rules.

  These encode the decisions ADR-0002 fixes, so a change to any of them is a
  change to a recorded decision and should fail here first. The last few tests
  check the committed artefact itself, so a build that violates a rule fails
  rather than shipping.
*/

const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const build = require('../tools/build-dictionary');

const root = path.resolve(__dirname, '..');

const FREQUENCY_SAMPLE = [
  'the 100000',
  'of 90000',
  'be 80000',
  "don't 70000",
  'state-of-the-art 60000',
  'running 50000',
  '42 40000',
  'Coca-Cola 30000',
  'café 20000',
  'quick 10000',
  'zebra 5000'
].join('\n');

const entry = (word, overrides = {}) => JSON.stringify({
  word,
  lang_code: 'en',
  pos: 'noun',
  ...overrides
});

// `glosses` is the upstream field name for a Sense's Definition.
const sense = (definition, overrides = {}) => ({ glosses: [definition], ...overrides });

// A Sense as the artefact holds it, for the tests that work after toSenses.
const senseOf = (pos, definition) => ({ pos, definitions: [definition], examples: [], synonyms: [], antonyms: [] });

// --- The candidate list --------------------------------------------------

test('the candidate list keeps only plain lowercase alphabetic tokens', () => {
  const candidates = build.selectCandidates(FREQUENCY_SAMPLE, 100);

  assert.deepEqual(candidates, ['the', 'of', 'be', 'running', 'quick', 'zebra']);
});

test('the cut-off takes the most frequent candidates, in order', () => {
  const candidates = build.selectCandidates(FREQUENCY_SAMPLE, 3);

  assert.deepEqual(candidates, ['the', 'of', 'be']);
});

test('coverage is measured against the word tokens the bundle can answer', () => {
  const coverage = build.measureCoverage(FREQUENCY_SAMPLE);

  // Only the tokens the bundle could serve count towards the denominator: the
  // question is how much running English the bundle answers, and a corpus total
  // that included "42", "don't" and "café" would answer a different one.
  // "café" is in the fixture to show that: it is alphabetic but not a
  // candidate, because the artefact's keys are ASCII.
  assert.equal(coverage.candidates, 6);
  assert.equal(coverage.corpusAlphabeticTokens, 335000);
  assert.equal(coverage.corpusWordTokens, 555000);
  assert.equal(coverage.covered(coverage.candidates), 1);
  assert.equal(coverage.covered(3), 270000 / 335000);
});

// --- Entry pruning -------------------------------------------------------

test('a Definition is the first upstream gloss, truncated to the budget', () => {
  const long = 'Definitions are not always short. This one goes on well past the budget.'.repeat(8);
  const senses = build.toSenses({
    pos: 'noun',
    senses: [sense(long), sense('A second Definition.')]
  });

  assert.equal(senses.length, 2, 'a second Sense is kept');
  assert.equal(senses[0].definitions.length, 1, 'only the first gloss of a Sense is kept');
  assert.equal(senses[0].definitions[0].length, 220);
  assert.ok(senses[0].definitions[0].endsWith('…'));
  assert.equal(senses[1].definitions[0], 'A second Definition.');
});

test('a Definition is left intact when it fits', () => {
  const senses = build.toSenses({ pos: 'noun', senses: [sense('A short Definition.')] });

  assert.equal(senses[0].definitions[0], 'A short Definition.');
});

test('whitespace in a Definition is collapsed rather than carried into the JSON', () => {
  const senses = build.toSenses({ pos: 'noun', senses: [sense('  A Definition\n  over   two  lines.  ')] });

  assert.equal(senses[0].definitions[0], 'A Definition over two lines.');
});

test('a Sense keeps one Example and four Synonyms and four Antonyms', () => {
  const senses = build.toSenses({
    pos: 'adj',
    senses: [sense('Bright.', {
      examples: [{ text: 'A bright day.' }, { text: 'A second example.' }],
      synonyms: ['luminous', 'vivid', 'brilliant', 'radiant', 'gleaming', 'shining'],
      antonyms: ['dull', 'dim', 'gloomy', 'drab', 'murky', 'sombre']
    })]
  });

  assert.deepEqual(senses[0].examples, ['A bright day.']);
  assert.deepEqual(senses[0].synonyms, ['luminous', 'vivid', 'brilliant', 'radiant']);
  assert.deepEqual(senses[0].antonyms, ['dull', 'dim', 'gloomy', 'drab']);
});

test('multi-word Synonyms and Antonyms are dropped rather than trimmed', () => {
  const senses = build.toSenses({
    pos: 'adj',
    senses: [sense('Happy.', {
      synonyms: ['happy as a lark', 'cheerful', 'upbeat', 'glad', 'jovial'],
      antonyms: ['down in the dumps', 'sad']
    })]
  });

  assert.deepEqual(senses[0].synonyms, ['cheerful', 'upbeat', 'glad', 'jovial']);
  assert.deepEqual(senses[0].antonyms, ['sad']);
});

test('a word is never listed twice in one Synonym list', () => {
  const senses = build.toSenses({
    pos: 'adj',
    senses: [sense('Quick.', {
      synonyms: ['fast', 'rapid', 'fast', 'swift', 'speedy', 'fast']
    })]
  });

  assert.deepEqual(senses[0].synonyms, ['fast', 'rapid', 'swift', 'speedy']);
});

test('at most eight Senses are kept', () => {
  const senses = build.toSenses({
    pos: 'noun',
    senses: Array.from({ length: 20 }, (_, i) => sense(`Sense number ${i}.`))
  });

  assert.equal(senses.length, 8);
});

test('two Senses with the same Definition are one Sense', () => {
  // Wiktionary routinely numbers one Sense several times with the same Definition
  // and different examples. Shown to a reader that is the same Definition
  // repeated, which reads as a fault in the extension rather than in the data.
  const senses = build.toSenses({
    pos: 'noun',
    senses: [
      sense('A number of places in the United States:', { examples: [{ text: 'In Iowa.' }] }),
      sense('A number of places in the United States:', { examples: [{ text: 'In Ohio.' }] }),
      sense('An entirely different Sense.')
    ]
  });

  assert.deepEqual(senses.map(s => s.definitions[0]), [
    'A number of places in the United States:',
    'An entirely different Sense.'
  ]);
  assert.deepEqual(senses[0].examples, ['In Iowa.'], 'the first one keeps its Example');
});

test('the same Definition under two parts of speech is two Senses', () => {
  // "Bank" the noun and "bank" the verb are the same word and the same Definition,
  // and collapsing them would lose the part of speech that tells them apart.
  const accumulator = build.createAccumulator(['bank']);
  build.recordLine(accumulator, entry('bank', { pos: 'noun', senses: [sense('A financial institution.')] }));
  build.recordLine(accumulator, entry('bank', { pos: 'verb', senses: [sense('A financial institution.')] }));

  assert.deepEqual(accumulator.headwords.get('bank').map(s => s.pos), ['noun', 'verb']);
});

test('the eight-Sense cap spans a word listed under several parts of speech', () => {
  const accumulator = build.createAccumulator(['well']);
  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    build.recordLine(accumulator, entry('well', {
      pos,
      senses: [sense(`A ${pos} sense one.`), sense(`A ${pos} sense two.`), sense(`A ${pos} sense three.`)]
    }));
  }

  // The cap is applied when the artefact is written, not while lines are read,
  // because upstream's order is not the order the reader should see.
  const entries = build.buildEntries(accumulator.headwords);
  assert.equal(entries.well.length, 8);
});

test('entry-level Synonyms and Antonyms are never surfaced', () => {
  // Wiktionary's entry-level lists are unsorted dumps spanning every Sense. A
  // generator that used them would show "happy as a lark" and "cheerful" beside
  // a Definition they have nothing to do with.
  const senses = build.toSenses({
    pos: 'adj',
    synonyms: ['entry-level synonym that must not appear'],
    antonyms: ['entry-level antonym that must not appear'],
    senses: [sense('Happy.')]
  });

  assert.deepEqual(senses[0].synonyms, []);
  assert.deepEqual(senses[0].antonyms, []);
});

test('a Sense with no Definition is dropped', () => {
  const senses = build.toSenses({
    pos: 'noun',
    senses: [sense(''), { glosses: [] }, sense('A real Definition.')]
  });

  assert.equal(senses.length, 1);
  assert.equal(senses[0].definitions[0], 'A real Definition.');
});

test('an entry with no Senses yields nothing', () => {
  assert.deepEqual(build.toSenses({ word: 'x', pos: 'noun' }), []);
  assert.deepEqual(build.toSenses({ word: 'x', pos: 'noun', senses: [] }), []);
});

// --- Line scanning -------------------------------------------------------

test('a line is only parsed when it names a wanted word', () => {
  const wanted = new Set(['hammer']);

  // The top-level word is what counts, but `"word"` also appears on nested
  // objects, so a false positive is allowed and only costs a parse.
  assert.equal(
    build.mayContainCandidate('{"word": "Hammer", "senses": []}', wanted),
    true
  );
  assert.equal(
    build.mayContainCandidate('{"descendants": [{"word": "hammer"}]}', wanted),
    true
  );
  assert.equal(build.mayContainCandidate('{"word": "shovel"}', wanted), false);
  assert.equal(build.mayContainCandidate('{"senses": [{"glosses": ["a hammer"]}]}', wanted), false);
});

test('a line split across chunks is still one line', () => {
  const lines = [];
  const splitter = build.createLineSplitter(line => lines.push(line));

  // The split lands inside a multi-byte character, which is the case a naive
  // `chunk.toString()` gets wrong.
  const text = '{"word":"café"}\n{"word":"x"}\n';
  const bytes = Buffer.from(text, 'utf8');
  for (let i = 0; i < bytes.length; i += 3) {
    splitter.push(bytes.subarray(i, i + 3));
  }
  splitter.end();

  assert.deepEqual(lines, ['{"word":"café"}', '{"word":"x"}']);
});

test('a final line with no trailing newline is kept', () => {
  const lines = [];
  const splitter = build.createLineSplitter(line => lines.push(line));

  splitter.push(Buffer.from('{"word":"a"}\n{"word":"b"}', 'utf8'));
  splitter.end();

  assert.deepEqual(lines, ['{"word":"a"}', '{"word":"b"}']);
});

test('the committed offset stops at the last complete line', () => {
  const splitter = build.createLineSplitter(() => {});

  splitter.push(Buffer.from('{"a":1}\n{"b":2}\n{"partial":', 'utf8'));

  // Both complete lines, and not the fragment - a resume from here re-reads the
  // fragment whole rather than losing it.
  assert.equal(splitter.committedBytes(), Buffer.byteLength('{"a":1}\n{"b":2}\n'));
});

test('the committed offset counts bytes, not characters', () => {
  const splitter = build.createLineSplitter(() => {});

  // A resume offset taken in characters rather than bytes would ask for a range
  // in the wrong place, which is how a resumed build silently loses a record.
  splitter.push(Buffer.from('{"w":"café"}\n', 'utf8'));

  assert.equal(splitter.committedBytes(), Buffer.byteLength('{"w":"café"}\n'));
  assert.notEqual(splitter.committedBytes(), '{"w":"café"}\n'.length);
});

test('a malformed line is skipped, not fatal', () => {
  const accumulator = build.createAccumulator(['hammer']);
  build.recordLine(accumulator, '{"word": "hammer", truncated');
  build.recordLine(accumulator, entry('hammer', { senses: [sense('A tool.')] }));

  assert.deepEqual(accumulator.headwords.get('hammer').length, 1);
});

test('a non-English entry is not merged into an English headword', () => {
  // The extraction is the English Wiktionary, but a foreign word quoted on an
  // English page still gets a line. Merging its Senses into the English headword
  // would put a French sense of "dog" beside the English one.
  const accumulator = build.createAccumulator(['dog']);
  build.recordLine(accumulator, entry('dog', { senses: [sense('A domesticated carnivorous mammal.')] }));
  build.recordLine(accumulator, JSON.stringify({
    word: 'dog',
    lang_code: 'fr',
    pos: 'noun',
    senses: [{ glosses: ['Chien.'] }]
  }));

  assert.deepEqual(
    accumulator.headwords.get('dog').map(s => s.definitions[0]),
    ['A domesticated carnivorous mammal.']
  );
});

test('a word is matched regardless of the case upstream wrote it in', () => {
  const accumulator = build.createAccumulator(['the']);
  build.recordLine(accumulator, entry('The', { senses: [sense('Definite article.')] }));

  assert.ok(accumulator.headwords.has('the'));
});

test('Senses from several entries for one word are concatenated', () => {
  const accumulator = build.createAccumulator(['walk']);
  build.recordLine(accumulator, entry('walk', { pos: 'verb', senses: [sense('To move on foot.')] }));
  build.recordLine(accumulator, entry('walk', { pos: 'noun', senses: [sense('A walk.')] }));

  const senses = accumulator.headwords.get('walk');
  assert.deepEqual(senses.map(s => s.pos), ['verb', 'noun']);
});

test('an inflection Sense does not lead, when the headword has a real one', () => {
  // Wiktionary files "walked" under its own page and emits the form-of line
  // before the headword's entry, so extraction order put "simple past and past
  // participle of walk" first for a reader who selected the word. The note is
  // still true and still worth carrying, so it is sorted after the real Senses
  // rather than dropped.
  const entries = build.buildEntries(new Map([
    ['walked', [
      senseOf('verb', 'simple past and past participle of walk'),
      senseOf('verb', 'To have walked; to have moved about on foot.')
    ]]
  ]));

  assert.deepEqual(entries.walked.map(s => s.definitions[0]), [
    'To have walked; to have moved about on foot.',
    'simple past and past participle of walk'
  ]);
});

test('a form-only headword takes the Senses of the headword it inflects', () => {
  // The frequency list is full of inflected forms in its top 20,000 - "did",
  // "told", "kids", "sighs" are all there - and Wiktionary files each as a bare
  // form-of line. Resolving rather than dropping is the difference between a
  // dictionary and a dictionary with holes where common words should be.
  const entries = build.buildEntries(new Map([
    ['do', [senseOf('verb', 'To perform or carry out.')]],
    ['did', [senseOf('verb', 'simple past of do'), senseOf('verb', 'past participle of do; done')]]
  ]));

  assert.deepEqual(entries.did.map(s => s.definitions[0]), ['To perform or carry out.']);
});

test('a form-only headword is dropped when the headword it inflects is not in the cut-off', () => {
  // There is nothing to point at, and the live-provider chain is a better answer
  // than a Definition about a word the reader did not select.
  const entries = build.buildEntries(new Map([
    ['zzzz', [senseOf('verb', 'simple past of zzzz')]]
  ]));

  assert.deepEqual(Object.keys(entries), []);
});

test('a form whose target is itself a form is dropped rather than chained', () => {
  const entries = build.buildEntries(new Map([
    ['ran', [senseOf('verb', 'simple past of run')]],
    ['run', [senseOf('verb', 'simple past of running')]]
  ]));

  assert.deepEqual(Object.keys(entries), []);
});

test('the form-of note a headword names is recognised', () => {
  for (const [definition, target] of [
    ['simple past of do', 'do'],
    ['past participle of do; done', 'do'],
    ['plural of kid', 'kid'],
    ['third-person singular simple present indicative of kid', 'kid'],
    ['simple past and past participle of tell', 'tell'],
    // Upstream capitalises freely, so the match must not depend on case.
    ['Alternative spelling of OK.', 'ok'],
    ['comparative degree of good and well', 'good'],
    // Every wording in the prefix list, so a form note that is recognised but not
    // redirectable drops its headword instead of resolving it. "weren" lost its
    // entry to exactly this.
    ['plural simple past of be', 'be'],
    ['remote past form of be.', 'be'],
    ['present of be', 'be'],
    ['first-person singular present indicative of be', 'be'],
    ['second-person plural simple present of be', 'be'],
    ['misspelling of definately', 'definately'],
    ['obsolete spelling of honour', 'honour'],
    ['inflection of go', 'go']
  ]) {
    assert.equal(build.inflectionTarget(definition), target, definition);
  }
});

test('a form-of note naming a phrase resolves to nothing', () => {
  // "closed-circuit television" and "take-off and landing data" are phrases, not
  // headwords, and there is no headword to point the reader at.
  assert.equal(
    build.inflectionTarget('Initialism of closed-circuit television; video surveillance.'),
    null
  );
  assert.equal(build.inflectionTarget('Acronym of take-off and landing data'), null);
});

test('a headword that redirects to itself is dropped', () => {
  // "sh" is its own alternative form, so resolving it would loop. The target has
  // no real Senses of its own, which is what stops it.
  const entries = build.buildEntries(new Map([
    ['sh', [senseOf('noun', 'Alternative form of Sh. Abbreviation of Shri.')]]
  ]));

  assert.deepEqual(Object.keys(entries), []);
});

test('a real Definition names no headword to redirect to', () => {
  // "Of or relating to a king" contains "of", so the redirect rule has to key on
  // the form-of wording rather than on the word being present.
  assert.equal(build.inflectionTarget('A tool used for cutting wood or metal.'), null);
  assert.equal(build.inflectionTarget('Of or relating to a king.'), null);
});

test('every kind of form-of Sense is recognised', () => {
  for (const definition of [
    'simple past of begin',
    'present participle and gerund of run',
    'third-person singular simple present of go',
    'third-person singular simple present indicative of go',
    'comparative degree of good',
    'superlative degree of good',
    'plural of dog',
    'inflection of go',
    'alternative form of colour',
    'alternative spelling of OK.',
    'obsolete spelling of honour',
    'misspelling of definately',
    'initialism of CCTV',
    'acronym of NATO'
  ]) {
    assert.equal(build.isInflection(definition), true, definition);
  }
});

test('a real Definition is not mistaken for a form-of note', () => {
  // The ones that matter are the Definitions which open with a word the
  // form-of list also uses. Requiring the "of" is what keeps them apart.
  for (const definition of [
    'A tool used for cutting wood or metal.',
    'To move about on foot.',
    'An animal kept for wool or meat.',
    'The mental process of reasoning.',
    'Of or relating to a king.',
    'Pluralism is a political philosophy.',
    'Simple past tenses are common in speech.',
    'Present participles are formed by adding -ing.',
    'Third-person singular agreement is obligatory in many languages.'
  ]) {
    assert.equal(build.isInflection(definition), false, definition);
  }
});

test('a form-of note naming a whole phrase is recognised but resolves to nothing', () => {
  // It is genuinely a form-of note, so it is demoted, but "closed-circuit" is not
  // a headword, so there is nothing to point the reader at. This is the case that
  // separates "is this a form-of note" from "does this name a headword", and it
  // is why the two are separate questions on one regex rather than one rule.
  assert.equal(
    build.isInflection('Initialism of closed-circuit television; video surveillance.'),
    true
  );
  assert.equal(build.inflectionTarget('Initialism of closed-circuit television.'), null);
  assert.equal(build.inflectionTarget('Acronym of take-off and landing data'), null);
});

test('a word with no usable Sense is not in the artefact at all', () => {
  // The alternative is a key that resolves to nothing, which a reader cannot
  // tell apart from the dictionary not knowing the word.
  const accumulator = build.createAccumulator(['zzzqqq']);
  build.recordLine(accumulator, entry('zzzqqq', { pos: 'noun' }));
  build.recordLine(accumulator, entry('zzzqqq', { pos: 'noun', senses: [sense('')] }));

  assert.equal(accumulator.headwords.has('zzzqqq'), false);
});

// --- Serialisation -------------------------------------------------------

test('the artefact is serialised in a stable order', () => {
  const headwords = new Map([
    ['zebra', [senseOf('noun', 'A striped animal.')]],
    ['apple', [senseOf('noun', 'A fruit.')]]
  ]);

  const json = build.serialise(build.buildEntries(headwords), { buildDate: '2026-09-29' });

  assert.deepEqual(Object.keys(JSON.parse(json).entries), ['apple', 'zebra']);
});

test('the same input gzips to the same bytes', () => {
  const json = build.serialise(build.buildEntries(new Map([['a', []]])), { buildDate: '2026-09-29' });

  assert.ok(build.gzip(Buffer.from(json)).equals(build.gzip(Buffer.from(json))));
});

// --- The pinned sources --------------------------------------------------

test('both upstream sources are pinned', () => {
  assert.match(
    build.SOURCES.frequencyWords.url,
    /FrequencyWords\/[a-f0-9]{40}\//,
    'the frequency list must be pinned at a commit'
  );
  assert.ok(
    build.SOURCES.wiktionary.etag,
    'the extraction has no versioned URL, so it needs an ETag pin'
  );
  assert.ok(build.SOURCES.wiktionary.wiktextractCommit);
});

test('an ETag compares equal however the server quotes it', () => {
  // kaikki.org serves this behind nginx, which quotes its ETags, and the HEAD
  // and GET responses have been seen differing in the quoting. Comparing the raw
  // header would fail a build against an unchanged file, which is the one
  // outcome the pin exists to prevent.
  for (const value of ['6ab646b9-c6d089b2', '"6ab646b9-c6d089b2"', 'W/"6ab646b9-c6d089b2"']) {
    assert.equal(build.normaliseEtag(value), '6ab646b9-c6d089b2');
  }
});

// --- The committed artefact ----------------------------------------------

// Skipped when the artefact has not been built yet, so a fresh clone can run the
// test suite without a 3.3 GB download first.
const ARTEFACT = path.join(root, 'data', 'wordglance-en-dictionary.json.gz');
const built = existsSync(ARTEFACT);

test('the committed artefact is the size the refresh document claims', { skip: !built }, () => {
  const compressed = statSync(ARTEFACT).size;
  const mb = compressed / 1e6;

  // ADR-0002 measured 215 bytes per headword gzipped and expected 4.3 MB. The
  // shipped artefact is 5.0 MB, and the difference is accounted for: Examples
  // are the count ADR-0002 fixes and a length it does not, and they are 2.6 MB of
  // the total. docs/dictionary-refresh.md records the deviation and the
  // alternatives considered.
  //
  // The bound is deliberately tight. It is here to catch a budget change that
  // nobody documented, not to bless whatever the build happens to produce — which
  // is why it is anchored on the documented figure rather than on ADR-0002's,
  // and why moving the budget without moving this number fails here.
  assert.ok(
    Math.abs(mb - 5.0) < 0.3,
    `compressed artefact is ${mb.toFixed(2)} MB; docs/dictionary-refresh.md says 5.0 MB. ` +
    'Either the budget changed or the document is now wrong.'
  );
});

test('the committed artefact is well inside the AMO package limit', { skip: !built }, () => {
  // 5 MB against a 200 MB limit, so this is not close. It is here so a future
  // decision to widen the cut-off trips it rather than being discovered at
  // submission.
  assert.ok(statSync(ARTEFACT).size < 100e6);
});

test('the committed artefact carries a build date and a coverage figure', { skip: !built }, () => {
  const { entries, meta } = readArtefact();

  assert.match(meta.buildDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(meta.candidateCount, 20000);
  assert.ok(meta.sources.wiktionary.etag);
  assert.ok(meta.sources.frequencyWords);

  // The coverage figure is what a future refresh compares itself against, so it
  // has to be the artefact's own number rather than a stated one.
  assert.equal(meta.headwordCount, Object.keys(entries).length);
  assert.equal(meta.coverage, meta.headwordCount / meta.candidateCount);
});

test('the committed artefact covers the great majority of the cut-off', { skip: !built }, () => {
  const { meta } = readArtefact();

  // ADR-0002 estimated about nine in ten. The real figure is higher, and the
  // reason is worth knowing: the misses are the frequency list's contraction
  // fragments ("didn", "somethin", "runnin"), which it splits on the
  // apostrophe, and which are not words a dictionary has an entry for. A figure
  // far below this band means the cut-off or the candidate filter changed.
  assert.ok(meta.coverage > 0.95, `coverage is ${meta.coverage}`);
});

test('no headword in the artefact leads with a form-of note', { skip: !built }, () => {
  // A Lookup that opens with "simple past of walk" has told the reader what
  // their word is a form of rather than what it means. The generator sorts
  // these last and resolves a form-only headword to the one it inflects, so none
  // should survive at the front.
  const { entries } = readArtefact();

  for (const [word, senses] of Object.entries(entries)) {
    assert.equal(
      build.isInflection(senses[0].definitions[0]),
      false,
      `${word} leads with the form-of note ${senses[0].definitions[0]}`
    );
  }
});

test('a resolved headword has a real Definition, not a chain of form-of notes', { skip: !built }, () => {
  // The previous test checks the first Sense; this one checks that no headword
  // in the artefact is *entirely* form-of notes, which is the state the redirect
  // exists to prevent. Without it, a headword whose only Senses name another
  // headword would pass on its first Sense alone if the generator ever gave it
  // one.
  const { entries } = readArtefact();

  for (const [word, senses] of Object.entries(entries)) {
    const real = senses.filter(s => !build.isInflection(s.definitions[0]));
    assert.ok(real.length > 0, `${word} is nothing but form-of notes`);
  }
});

test('the committed artefact honours the per-headword budget', { skip: !built }, () => {
  const { entries, meta } = readArtefact();
  const budget = meta.budget;

  for (const [word, senses] of Object.entries(entries)) {
    assert.ok(senses.length <= budget.senses, `${word} has ${senses.length} Senses`);
    for (const s of senses) {
      for (const definition of s.definitions) {
        assert.ok(definition.length <= budget.definitionChars, `${word} Definition too long`);
      }
      assert.ok(s.examples.length <= budget.examples, `${word} has too many Examples`);
      for (const example of s.examples) {
        assert.ok(example.length <= budget.exampleChars, `${word} Example too long`);
      }
      assert.ok(s.synonyms.length <= budget.synonyms, `${word} has too many Synonyms`);
      assert.ok(s.antonyms.length <= budget.antonyms, `${word} has too many Antonyms`);
      for (const relation of [...s.synonyms, ...s.antonyms]) {
        assert.doesNotMatch(relation, /\s/, `${word} has a multi-word relation`);
      }
    }
  }
});

test('no headword carries the same Sense twice', { skip: !built }, () => {
  const { entries } = readArtefact();

  for (const [word, senses] of Object.entries(entries)) {
    const seen = new Set();
    for (const s of senses) {
      // The generator's own identity function, not a re-derivation of it: a test
      // that spelled the rule differently would pass when the rule was wrong.
      const key = build.senseKey(s);
      assert.ok(!seen.has(key), `${word} repeats the Sense "${s.definitions[0]}"`);
      seen.add(key);
    }
  }
});

// The `zip` command from the release workflow, as a list of the paths it packs.
//
// The command is continued with trailing backslashes, so it runs to the first
// line that is not. Slicing to a fixed offset would silently start asserting
// on a different step the day someone reformats the file above it.
function releaseBuildFileList() {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'build-and-release-xpi.yml'),
    'utf8'
  );

  const start = workflow.indexOf('zip -r');
  assert.ok(start > -1, 'the workflow still zips an explicit file list');

  const command = workflow
    .slice(start)
    .split('\n')
    .reduce((lines, line) => {
      if (lines.length && !lines[lines.length - 1].trimEnd().endsWith('\\')) return lines;
      return [...lines, line];
    }, [])
    .join('\n');

  return command
    .split('\n')
    .slice(1)
    .flatMap(line => line.trim().replace(/\\$/, '').split(/\s+/))
    // `path` would shadow the module binding this file uses everywhere else.
    .filter(entry => entry && entry !== '\\');
}

test('the packaged dictionary is in the release build', { skip: !built }, () => {
  // The bundle is only the answer ADR-0002 promises if it ships. The release
  // workflow zips an explicit file list, so an artefact that is committed but
  // left out of that list fails in a published extension, silently, by falling
  // back to the live provider for every word.
  const packed = releaseBuildFileList();

  assert.ok(
    packed.includes('data'),
    'the packaged dictionary is not in the XPI file list, so every Definition ' +
    'would fall through to the live provider in a published build'
  );
});

test('every file the manifest loads is in the release build', () => {
  // The manifest is the one declaration of what the extension loads; the
  // workflow's `zip` list is a second, hand-maintained declaration of what
  // ships. `wiktionary.js` was in the first and not the second, and nothing
  // caught it: the test above asks whether a directory is listed, and a missing
  // script is not a missing directory.
  //
  // A build without it is an extension whose background script throws
  // `WiktionaryUtils is not defined` on the first Translation - which is every
  // Translation, and every pronunciation. It fails only in a browser, only for
  // a reader, and only after install. See ADR-0006.
  //
  // The settings page counts, and so does the stylesheet it loads: the manifest
  // names the page, and only the page names the stylesheet, so a list derived
  // from the manifest alone would leave the one file it does not mention to a
  // hand-typed entry - which is the disagreement this test exists to prevent.
  const packed = releaseBuildFileList();
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const popup = manifest.browser_action.default_popup;

  const loaded = [
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap(content => content.js),
    popup,
    ...[...readFileSync(path.join(root, popup), 'utf8')
      .matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(([, file]) => file)
  ];

  for (const file of loaded) {
    assert.ok(
      packed.includes(file),
      `${file} is loaded by the extension but is not in the XPI file list, ` +
      'so a published build cannot read it'
    );
  }
});

function readArtefact() {
  const zlib = require('node:zlib');
  return JSON.parse(zlib.gunzipSync(readFileSync(ARTEFACT)).toString('utf8'));
}

// The names inside a zip, read from its central directory.
//
// Written out rather than shelled out to `unzip` because a test that depends on
// an external binary fails on a machine without it, and the whole point here is
// to be a check that runs everywhere the suite runs. Only the directory is read:
// the question is which files are in the package, never what is inside one.
//
// Two signatures and three length fields are the whole format that is needed, and
// they are at fixed offsets rather than at offsets derived from the entry before,
// so a walk cannot lose its place part-way through a listing.
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;

function zipEntryNames(file) {
  const bytes = readFileSync(file);

  // The end-of-central-directory record sits at the very end, after a comment of
  // up to 64 KB, so it is searched for from the back rather than assumed.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (bytes.readUInt32LE(at) === ZIP_EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error(`${file} is not a zip: no end-of-central-directory record`);

  const count = bytes.readUInt16LE(end + 10);
  const names = [];

  for (let at = bytes.readUInt32LE(end + 16), read = 0; read < count; read++) {
    if (bytes.readUInt32LE(at) !== ZIP_CENTRAL_HEADER) {
      throw new Error(`${file} is not a readable zip: bad central directory header`);
    }
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);

    names.push(bytes.toString('utf8', at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength));
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  return names;
}

// Every package in `dist/`, which is where a reader verifying a claim about the
// extension will look for one.
const packages = readdirSync(path.join(root, 'dist'))
  .filter(name => name.endsWith('.xpi'))
  .map(name => path.join(root, 'dist', name));

// A package that cannot answer a common word offline is a package that breaks
// the promise ADR-0002 makes, and `dist/` is where a reader goes to check that
// the promise is real.
//
// Two of them sat here for several releases without `data/`, and a real-browser
// check reported the exact symptom a package without it produces
// (`Connection error - please try again` for a word the bundle carries) before
// anyone established that the network was not at fault. The test above catches a
// build that leaves `data/` out; this one catches a package already built
// without it, which is the failure that reached a reader.
//
// Read out of each package rather than out of the workflow's file list, because
// the workflow describes what the *next* build will contain and this asks what
// the committed one does. A stale artefact is exactly the gap between the two.
test('every package in dist/ carries the bundled dictionary', { skip: !packages.length }, () => {
  for (const file of packages) {
    const names = zipEntryNames(file);
    assert.ok(
      names.some(name => name.startsWith('data/')),
      `${path.basename(file)} has no data/ directory, so a common word read out ` +
      'of it falls through to the live provider and answers a connection error ' +
      'with no network. Remove it, or rebuild it against the current manifest.'
    );
  }
});

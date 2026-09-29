/*
  What counts as a headword.

  The predicate is shared between the trigger and the background, and the
  background's use of it is covered end to end in background.test.js. These
  tests cover the predicate's own decisions, because the trigger's use of it is
  not separately reachable: a mistake here either shows a trigger that cannot
  lead anywhere or rejects a word a reader plainly selected.
*/

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadHeadwordUtils() {
  const context = vm.createContext({});
  for (const file of ['shared-constants.js', 'shared-utilities.js']) {
    vm.runInContext(readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

// The predicate is a pure function, so one loaded context serves every case.
const normalize = vm.runInContext(
  '(text) => HeadwordUtils.normalize(text)',
  loadHeadwordUtils()
);

test('a single word is a headword', () => {
  assert.equal(normalize('hammer'), 'hammer');
  assert.equal(normalize('Hammer'), 'Hammer');
  assert.equal(normalize('a'), 'a');
});

test('surrounding whitespace is trimmed, not rejected', () => {
  assert.equal(normalize('  hammer  '), 'hammer');
  assert.equal(normalize('\thammer\n'), 'hammer');
});

test("a contraction and a hyphenated word are single words", () => {
  assert.equal(normalize("don't"), "don't");
  assert.equal(normalize('end-to-end'), 'end-to-end');
  assert.equal(normalize('e-mail'), 'e-mail');
});

test('the typographic apostrophe is part of a word, not a rejection', () => {
  // A reader selecting from a typeset page gets U+2019, not a straight quote.
  assert.equal(normalize('don’t'), 'don’t');
  assert.equal(normalize('rock’n’roll'), 'rock’n’roll');
});

test('a non-English headword is a headword', () => {
  // WordGlance reads English Definitions for a non-English Source language, and
  // the reader selects that word on the page they are reading.
  assert.equal(normalize('café'), 'café');
  assert.equal(normalize('日本語'), '日本語');
  assert.equal(normalize('हिन्दी'), 'हिन्दी');
  assert.equal(normalize('naïve'), 'naïve');
});

test('a multi-word selection is not a headword', () => {
  for (const selection of [
    'claw hammer',
    'claw  hammer',
    'claw\thammer',
    'claw\nhammer',
    'the quick brown fox',
    'a b'
  ]) {
    assert.equal(normalize(selection), '', `${JSON.stringify(selection)} was accepted`);
  }
});

test('a selection with no letter in it is not a headword', () => {
  // Otherwise a page's line numbers, prices and stray punctuation would each
  // produce a trigger and a request.
  for (const selection of ['123', '42', '!', '--', '...', '.', '-', '3.14', '1,000']) {
    assert.equal(normalize(selection), '', `${JSON.stringify(selection)} was accepted`);
  }
});

test('a NUL is stripped rather than ending the word', () => {
  // Written as an escape deliberately: a literal NUL byte in a source file
  // makes git treat the file as binary, so it would never diff or merge.
  assert.equal(normalize('ham\x00mer'), 'hammer');
});

test('a tab or a newline is not stripped, because it is not part of the word', () => {
  // A reader's selection can span a line break. Joining the halves would invent
  // a word that is not on the page, and treating that as a headword would send
  // it to a provider.
  assert.equal(normalize('ham\tmer'), '');
  assert.equal(normalize('ham\nmer'), '');
});

test('an empty or whitespace-only selection is not a headword', () => {
  for (const selection of ['', '   ', '\n\n', '\t']) {
    assert.equal(normalize(selection), '');
  }
});

test('an implausibly long run of one character is not a headword', () => {
  // It contains no whitespace, so the rejection rule alone would accept it and
  // turn it into a very long provider URL.
  assert.equal(normalize('a'.repeat(65)), '');
  assert.equal(normalize('a'.repeat(5_000)), '');
});

test('the longest real word is still a headword', () => {
  // antidisestablishmentarianism is 28 characters, and German compounds run
  // longer. The bound has to clear them, not the other way round.
  for (const word of ['antidisestablishmentarianism', 'electrocardiographically']) {
    assert.equal(normalize(word), word);
  }
});

test('a non-string is not a headword', () => {
  for (const value of [null, undefined, 0, 42, {}, [], true]) {
    assert.equal(normalize(value), '');
  }
});

test('markup characters are rejected rather than passed through', () => {
  // The extension renders everything with textContent, so these could not inject
  // anything. Rejecting them anyway keeps a selection that is not a word from
  // becoming a request.
  for (const selection of ['<script>', 'hammer&co', 'a>b', 'a"b', '<b>hammer</b>']) {
    assert.equal(normalize(selection), '', `${JSON.stringify(selection)} was accepted`);
  }
});

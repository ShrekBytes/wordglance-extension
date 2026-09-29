/*
  Wiktionary Reader: WordGlance Extension
  Reads the Translation Field and the pronunciation out of a headword's
  Wiktionary page.

  One page, one request, two Fields - the page carries both, which is the whole
  reason this is the source for them. See ADR-0003.
*/

// Where a file name on Wikimedia Commons is played from. Named in manifest.json
// alongside the other hosts a selection reaches.
//
// Commons serves a file from a path hashed out of its name, and Special:FilePath
// is the documented way to ask for the file itself rather than its description
// page. Resolving a name into a playable URL locally therefore costs no
// request, which is what keeps a pronunciation free. The redirect it answers
// with is followed by the browser's own media stack, as it is for any other
// audio element.
const COMMONS_FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath';

// The headword's page is read in its own language section only. A page for a
// word that exists in several languages carries a Translations block per
// language and a Pronunciation block per language, and the reader selected the
// English headword - which is the headword WordGlance has Definitions for at
// all, since the dictionary provider is English.
function englishSection(markup) {
  const heading = /^==English==[ \t]*$/m.exec(markup);
  if (!heading) return '';

  const rest = markup.slice(heading.index + heading[0].length);

  // The section runs until the next level-two heading. `===Noun===` and deeper
  // are inside it; `==Danish==` is not.
  const end = /^==[^=]/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

// A translation row is a list item naming a language and holding its
// equivalents: `* Bengali: {{t+|bn|হাতুড়ি}}, {{t|bn|মারিবল}}`.
//
// Requiring a character between the `*` and the first colon is what keeps the
// nested dialect rows out - `*: Egyptian Arabic: {{t|arq|...}}` - which sit
// below the language they are a dialect of and are not the headword's
// equivalents in the reader's Target language.
const TRANSLATION_ROW = /^\*\s*[^:\n]+:/;

// The templates a row is built from. The first two arguments are the language
// code and the word, and the rest are gender, transliteration and usage notes
// the reader does not want. A page writes these under
// `{{trans-top}}`/`{{trans-bottom}}` or inside one `{{multitrans|data=...}}`
// block, and a row reads the same either way, so which shape a given editor used
// does not matter.
const TRANSLATION_TEMPLATE = /\{\{(t|tt)[+-]?\|([^|{}]*)\|(.*?)\}\}/g;

// A recording, or the shorthand for one. The first argument is the language it
// is qualified with and the second is the file name.
const RECORDING_TEMPLATE = /\{\{(?:audio|a)\|([^|{}]*)\|([^|{}]*)/g;

// `[[a|b]]` and `[[a]]` are how Wiktionary's markup writes a word that is also a
// page of its own, which is most of them. The reader is reading a word rather
// than the markup that holds it.
const displayText = text => text
  .replace(/\[\[[^[\]|]*\|([^\]]*)\]\]/g, '$1')
  .replace(/\[\[([^\]]*)\]\]/g, '$1');

const WiktionaryUtils = {
  // Every equivalent the page lists for one language, in page order and without
  // repeats. Several alternatives inside one language is a requirement rather
  // than a nicety: a reader often has to choose between the formal and the
  // colloquial word, so every one of them is shown.
  //
  // A headword can carry a Translations block per Sense, and the same word
  // appears in more than one of them. The first mention is the one kept, so
  // page order still reads true to the page.
  //
  // Every list item in the section is a candidate, rather than only those under a
  // Translations heading, because a second boundary rule has to be right about
  // pages it has not seen: one that skips a block the page happens to spell
  // differently would take the whole Translation Field with it. Measured over
  // 3,500 rows of real pages, none sit outside a Translations heading, so the
  // wider rule costs nothing today and cannot cost everything tomorrow.
  readTranslations(markup, targetLanguage) {
    const equivalents = [];

    for (const row of englishSection(markup).split('\n')) {
      if (!TRANSLATION_ROW.test(row)) continue;

      for (const [, , language, args] of row.matchAll(TRANSLATION_TEMPLATE)) {
        if (language.trim() !== targetLanguage) continue;

        // The word is the first positional argument, and links are resolved to
        // their display text before the arguments are split apart: a link's own
        // `|` would otherwise be read as the separator, and `[[bəxt|bəxti]]`
        // would reach the reader as `[[bəxt`.
        const word = displayText(args).split('|')[0].trim();
        if (word && !equivalents.includes(word)) {
          equivalents.push(word);
        }
      }
    }

    return equivalents;
  },

  // The recordings the page lists for the headword, in page order, each with the
  // language it is qualified with - empty when it is qualified with none.
  //
  // A file name carries an extension and an accent heading does not, which is
  // the whole of the difference between a recording and `{{a|en|UK}}` once the
  // two share a name.
  recordings(markup) {
    return Array.from(englishSection(markup).matchAll(RECORDING_TEMPLATE), ([, language, file]) => ({
      language: language.trim(),
      file: file.trim()
    })).filter(recording => recording.file.includes('.'));
  },

  // The recording the pronounce control plays, chosen by preference running from
  // an unqualified file, to one qualified with the reader's Target language, to
  // the first on the page.
  //
  // The last rung is the one that decides most Lookups: a page's recordings are
  // nearly all qualified with the language they are in, so a reader whose Target
  // language is not the headword's falls through to it. Any pronunciation beats
  // none, and an accent the reader does not recognise is still an accent they
  // can hear the word in.
  readAudio(markup, targetLanguage) {
    const recordings = WiktionaryUtils.recordings(markup);
    const chosen = recordings.find(recording => !recording.language)
      || recordings.find(recording => recording.language === targetLanguage)
      || recordings[0];

    return chosen ? WiktionaryUtils.playUrl(chosen.file) : '';
  },

  // A playable URL for a file name. Spaces become underscores because that is
  // how Commons stores them, and the rest is percent-encoded because
  // reader-voice recordings carry brackets and accents.
  playUrl(file) {
    return `${COMMONS_FILE_PATH}/${encodeURIComponent(file.replace(/ /g, '_'))}`;
  }
};

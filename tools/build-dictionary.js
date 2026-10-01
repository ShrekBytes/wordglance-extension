#!/usr/bin/env node
/*
  Builds the bundled English dictionary artefact from kaikki.org's Wiktionary extraction.

  The decisions this implements are fixed in ADR-0002 and in issue #15. They are
  repeated here so a future change to one of them is a visible edit rather than a
  quiet drift:

    word list      FrequencyWords en_50k.txt, pinned at a commit
    candidates     [a-z]+ tokens only (46,717 of them)
    cut-off        the top 20,000 candidates by corpus frequency
    per headword   first Definition truncated to 220 chars, one Example,
                   four Synonyms, four Antonyms, eight Senses

  Usage:
    node tools/build-dictionary.js [--build-date YYYY-MM-DD]
                                  [--expect-etag <etag>]
                                  [--candidate-source <path>]
                                  [--extraction-source <path>]
                                  [--out <path>]

  The two --*-source flags read a pinned source from disk instead of the network.
  They exist for iterating on the pruning rules: the extraction is 3.3 GB and
  takes about 45 minutes to stream, so a change to a rule should be tried against
  a local copy first. A build from a local source is not a candidate for
  committing - the ETag is not re-checked, so the artefact it produces is only as
  trustworthy as the file it was given.

  Reproducibility: the artefact is a pure function of the two pinned sources and
  the build date, and the build date is an explicit input, so rerunning with the
  same three produces a byte-identical file. gzip is written at a fixed level
  with a zeroed mtime, which is what makes that true.
*/

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- The pinned sources -------------------------------------------------

const SOURCES = {
  frequencyWords: {
    // Commit-pinned, so the candidate list cannot change under us.
    url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt',
    bytes: 622749
  },
  wiktionary: {
    url: 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl',
    // kaikki.org republishes this file in place, with no versioned URL, so it
    // cannot be pinned by commit. The ETag below is the pin, and
    // --expect-etag fails the build if the file has moved, so a refresh is
    // always a deliberate act rather than a silent one.
    //
    // The request asks for the identity encoding on purpose: kaikki.org serves
    // a different ETag for its gzip-negotiated variant of the same content, so
    // pinning the compressed ETag would make the pin depend on the client.
    etag: '6ab646b9-c6d089b2',
    lastModified: 'Fri, 25 Sep 2026 10:02:33 GMT',
    bytes: 3335555506,
    // The extraction tooling version that produced the pinned file, taken from
    // the kaikki.org page for this dictionary.
    wiktextractCommit: '1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a'
  }
};

// Asks for the file uncompressed, both to make the ETag a stable pin and
// because a 3.3 GB transfer spends most of its time on the wire rather than in
// the parser if it is not compressed.
const WIKTIONARY_HEADERS = { 'accept-encoding': 'identity' };

// --- The per-headword budget, from ADR-0002 ------------------------------

const BUDGET = {
  candidates: 20000,
  // Named for the domain term, not for the upstream field. The upstream calls
  // these `glosses`; CONTEXT.md calls a Sense's wording a Definition, and
  // "gloss" is on that glossary's avoid list, so the artefact's own vocabulary
  // is the one used here and in the recorded budget.
  definitionChars: 220,
  // An Example is a full sentence rather than a phrase, and it is the largest
  // single string in the artefact: measured at 2.6 MB of the 5.0 MB, more than
  // every Definition and relation together. It is capped so a quotation from a
  // nineteenth-century text cannot dominate the package.
  //
  // The cap is not a recorded decision. ADR-0002 fixes the count of one Example
  // per Sense but says nothing about its length, and this is the reason the
  // artefact is 5.0 MB rather than the ADR's 4.3 MB. Truncating to 120
  // characters would fit the ADR's figure and is not done, because 120
  // characters is roughly one clause. See docs/dictionary-refresh.md.
  exampleChars: 440,
  examples: 1,
  synonyms: 4,
  antonyms: 4,
  senses: 8
};

const OUT_PATH = path.resolve(__dirname, '..', 'data', 'wordglance-en-dictionary.json.gz');

// --- Candidate list -----------------------------------------------------

// Parses the frequency list's "word count" lines, in file order. Split on the
// last space because a word may itself contain one.
function parseFrequencyRows(text, onRow) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    const space = line.lastIndexOf(' ');
    if (space < 0) continue;
    const count = Number(line.slice(space + 1));
    if (!Number.isFinite(count)) continue;
    onRow(line.slice(0, space), count);
  }
}

// Filters the frequency list to plain lowercase alphabetic tokens. The list is
// dominated by tokens carrying apostrophes, hyphens and digits, which are not
// headwords this dictionary can serve.
function isCandidate(word) {
  return /^[a-z]+$/.test(word);
}

function selectCandidates(text, limit) {
  const candidates = [];
  parseFrequencyRows(text, word => {
    if (!isCandidate(word)) return;
    candidates.push(word);
  });
  return candidates.slice(0, limit);
}

// Coverage of the cut-off, as a share of the word tokens in the corpus. The
// denominator is every alphabetic token in the list, because that is the
// measure that answers "how much running English can the bundle answer".
function measureCoverage(text) {
  const rows = [];
  let wordTokens = 0;
  let alphaTokens = 0;

  parseFrequencyRows(text, (word, count) => {
    wordTokens += count;
    if (!isCandidate(word)) return;
    alphaTokens += count;
    rows.push(count);
  });

  // Coverage at any cut-off, not just the ones ADR-0002 happens to quote, so a
  // test or a future decision can ask about an arbitrary one.
  const covered = (n) => rows.slice(0, n).reduce((a, b) => a + b, 0) / alphaTokens;
  return {
    candidates: rows.length,
    covered,
    // Both totals are here so the denominator a coverage figure was measured
    // against is recoverable, and so a change to the filter that silently moved
    // the denominator is visible rather than merely changing the percentage.
    corpusAlphabeticTokens: alphaTokens,
    corpusWordTokens: wordTokens
  };
}

// --- Entry pruning ------------------------------------------------------

// Synonyms and Antonyms are bare words. A multi-word phrase is filtered out at
// the source rather than trimmed, because "happy as a lark" is not a word and
// truncating it to "happy" would invent a synonym the source did not assert.
function isBareWord(value) {
  return typeof value === 'string' && value.length > 0 && !/\s/.test(value);
}

function bareWords(list, limit) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const word = typeof item === 'string' ? item : item && item.word;
    if (!isBareWord(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length === limit) break;
  }
  return out;
}

function truncate(text, max) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// Identifies a Sense by what the reader would see of it. Wiktionary routinely
// splits one Sense into several numbered Senses carrying the same Definition and
// different examples - the first build carried "A number of places in the United
// States:" three times for one headword, which reads as a bug in the extension.
// A Sense is a distinct meaning, so an identical one is not a second Sense.
const senseKey = (sense) => JSON.stringify([sense.pos, sense.definitions[0]]);

// True for a Sense that points at another word instead of describing the
// headword: "simple past of walk", "plural of dog", "comparative degree of good".
//
// Wiktionary files these under the inflected form, and emits that line *before*
// the headword's own entry. Taking extraction order as given therefore put
// "simple past and past participle of walk" as the only Definition for "walked",
// and led "dogs" with "plural of dog" - a reader selecting an extremely common
// word told something about a different word. Several thousand of the 20,000
// headwords resolve to nothing but these, and more lead with one; the measured
// counts are in docs/dictionary-refresh.md.
//
// A form-of note is always "… of <headword>" or "… of <phrase>". Requiring the
// "of" is what separates a form note from a real Definition that merely opens
// with one of these words: "Simple past tenses are common in speech" and
// "Pluralism is a political philosophy" are Definitions, not redirects.
//
// One prefix list, and the target matcher is derived from it. Two separate lists
// is how they drift: a prefix that counts as a form note but not as a redirect
// silently drops the headword instead of resolving it, which is how "weren" lost
// its entry to a rule that was two lines out of date.
const INFLECTION_PREFIX =
  'present participle and gerund|simple past and past participle|' +
  'third-person singular simple present(?: indicative)?|' +
  '(?:first|second|third)-person(?: singular| plural)? simple present(?: indicative)?|' +
  '(?:first|second|third)-person singular present(?: indicative)?|' +
  'first-person plural simple present(?: indicative)?|' +
  'first-person singular simple present(?: indicative)?|' +
  'first-person singular present(?: indicative)?|' +
  'first-person simple present(?: indicative)?|' +
  'third-person plural simple present(?: indicative)?|' +
  'plural simple past|remote past form|' +
  'simple past and|past participle|simple past|present participle|' +
  'present|plural|inflection|comparative degree|superlative degree|' +
  'alternative form|alternative spelling|obsolete form|obsolete spelling|' +
  'misspelling|initialism|acronym|shortened';

// The whole form-of note. Group 1 is the wording, group 2 the headword it names
// when it names one.
const INFLECTION_NOTE = new RegExp(
  `^(?:${INFLECTION_PREFIX})\\s+of\\s+(?:([A-Za-z][A-Za-z']*)(?:\\.|\\b)(?=$|[\\s;,])|\\S+)`,
  'i'
);

const isInflection = (definition) => INFLECTION_NOTE.test(definition);

// The headword a form-of note points at, or null when it names a phrase rather
// than a headword: "simple past and past participle of tell" tells us about
// "tell"; "Initialism of closed-circuit television" names no headword at all, and
// redirecting "cctv" to a headword called "closed-circuit" would be worse than
// dropping it.
const inflectionTarget = (definition) => {
  const match = INFLECTION_NOTE.exec(definition);
  return match && match[1] ? match[1].toLowerCase() : null;
};

// One Sense. A Sense carries its own Definitions, Examples, Synonyms and
// Antonyms; entry-level lists are never used, because they are unsorted dumps
// that mix Senses together.
function toSenses(entry) {
  const senses = [];
  const seen = new Set();

  for (const sense of entry.senses || []) {
    // `glosses` is the upstream field name; what it holds is a Sense's first
    // Definition, which is what the artefact stores and the glossary calls it.
    const definition = truncate((sense.glosses || [])[0], BUDGET.definitionChars);
    if (!definition) continue;

    const built = {
      pos: entry.pos || '',
      definitions: [definition],
      examples: [],
      synonyms: bareWords(sense.synonyms, BUDGET.synonyms),
      antonyms: bareWords(sense.antonyms, BUDGET.antonyms)
    };

    const key = senseKey(built);
    if (seen.has(key)) continue;
    seen.add(key);

    for (const example of sense.examples || []) {
      const text = truncate(example && example.text, BUDGET.exampleChars);
      if (!text) continue;
      built.examples.push(text);
      if (built.examples.length === BUDGET.examples) break;
    }

    senses.push(built);
    if (senses.length === BUDGET.senses) break;
  }
  return senses;
}

// --- Stream processing --------------------------------------------------

// A cheap pre-filter over the raw line. The full line averages 24 KB, and only
// a few thousand of them carry a word we want, so parsing all 3.3 GB would spend
// the whole run in JSON.parse. `"word": "..."` also occurs on nested objects
// (descendants, translations), so every occurrence is tested and a false
// positive merely costs a parse.
function mayContainCandidate(line, candidates) {
  const pattern = /"word": ?"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (candidates.has(match[1].toLowerCase())) return true;
  }
  return false;
}

// Holds the running result of a build, so a retried download continues rather
// than starting over. Lines already handled are, by definition, before any
// resume offset, so a resumed run never sees one twice.
function createAccumulator(candidates) {
  return {
    wanted: new Set(candidates),
    headwords: new Map(),
    lines: 0,
    parsed: 0,
    bytes: 0
  };
}

function recordLine(accumulator, line) {
  accumulator.lines += 1;
  if (!line || !mayContainCandidate(line, accumulator.wanted)) return;
  accumulator.parsed += 1;

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    // A malformed line is not worth failing a multi-hour run over, and a
    // truncated final line on a resumed transfer is the expected case here.
    return;
  }

  // The extraction is the English Wiktionary, so most entries are English, but a
  // foreign word quoted on an English page appears as a translation of an
  // English headword, not as a headword of its own. Filtering on the entry's own
  // language keeps those out rather than letting a French sense of "dog" stand
  // beside the English one.
  if (entry.lang_code !== 'en') return;

  const word = typeof entry.word === 'string' ? entry.word.toLowerCase() : '';
  if (!accumulator.wanted.has(word)) return;
  const senses = toSenses(entry);
  if (!senses.length) return;

  // Senses accumulate across the several entries upstream has for one word -
  // one per part of speech, and more where a page carries both a headword line
  // and an inflection line. The cap and the de-duplication are applied here
  // rather than per entry, because eight Senses is a budget for the headword, not
  // for each part of speech it happens to be listed under.
  const existing = accumulator.headwords.get(word) || [];
  for (const sense of senses) {
    if (existing.some(kept => senseKey(kept) === senseKey(sense))) continue;
    existing.push(sense);
  }
  accumulator.headwords.set(word, existing);
}

// Feeds newline-delimited text to `onLine`, tolerating a UTF-8 sequence split
// across two chunks and a final line with no trailing newline. Both are normal,
// not corruption: HTTP chunks and JSONL records have no relationship.
function createLineSplitter(onLine) {
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  let buffered = '';
  // Bytes covered by lines already handed to onLine, newline included. This is
  // the offset a dropped connection should resume from: a line that arrived
  // only in part is not in this count, so it is re-read whole rather than
  // processed twice or half-processed.
  let committed = 0;

  const drain = () => {
    let newline = buffered.indexOf('\n');
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      committed += encoder.encode(line).length + 1;
      onLine(line);
      newline = buffered.indexOf('\n');
    }
  };

  return {
    push(chunk) {
      buffered += decoder.decode(chunk, { stream: true });
      drain();
    },
    committedBytes() {
      return committed;
    },
    // Anything still buffered is the last line, which upstream may or may not
    // have terminated.
    end() {
      buffered += decoder.decode();
      if (buffered.length) {
        committed += encoder.encode(buffered).length;
        onLine(buffered);
        buffered = '';
      }
    }
  };
}

// Reads one response body into the accumulator, returning the byte offset at the
// end of the last complete line.
async function consumeStream(stream, accumulator, onProgress) {
  let received = 0;
  let nextReport = 50_000_000;
  const startBytes = accumulator.bytes;

  const splitter = createLineSplitter(line => recordLine(accumulator, line));

  try {
    for await (const chunk of stream) {
      received += chunk.length;
      splitter.push(chunk);
      if (received >= nextReport) {
        nextReport += 50_000_000;
        onProgress({
          bytes: startBytes + received,
          lines: accumulator.lines,
          headwords: accumulator.headwords
        });
      }
    }
  } finally {
    // A throw here is a dropped connection. The splitter is intentionally not
    // ended, so its incomplete tail is left for the resume to re-read.
    accumulator.bytes = startBytes + splitter.committedBytes();
  }

  splitter.end();
  accumulator.bytes = startBytes + splitter.committedBytes();
  return accumulator.bytes;
}

const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 60;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Streams the extraction, resuming from wherever the last attempt stopped.
//
// A 3.3 GB transfer over a connection that is not ours will drop, and a build
// that loses its whole run to a dropped socket is not a build anyone runs twice.
// Each retry asks for a byte range from the last complete line.
async function streamWithResume(openSource, candidates, totalBytes, onProgress) {
  const accumulator = createAccumulator(candidates);
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startBytes = accumulator.bytes;

    let body;
    try {
      body = await openSource(startBytes);
    } catch (error) {
      // A connection that will not open at all. Distinct from a stream that
      // opened and then died, and it needs no different handling: retry the
      // same offset.
      lastError = error;
      await wait(RETRY_DELAY_MS);
      continue;
    }

    try {
      const committed = await consumeStream(body, accumulator, onProgress);
      if (committed >= totalBytes) return accumulator;
      // The body ended without throwing but before the end of the file. Same
      // remedy: ask again from where it stopped.
      lastError = new Error(`Extraction ended early at byte ${committed} of ${totalBytes}`);
    } catch (error) {
      lastError = error;
      onProgress({
        bytes: accumulator.bytes,
        lines: accumulator.lines,
        headwords: accumulator.headwords,
        attempt,
        note: `stream stopped at byte ${accumulator.bytes}, resuming`
      });
    }

    await wait(RETRY_DELAY_MS);
  }

  throw lastError || new Error('Extraction stream could not be read to completion');
}

// Nginx quotes its ETags, and the HEAD and GET responses can differ in quoting,
// so both are normalised away before comparing. Comparing the raw header would
// fail a build against an unchanged file.
const normaliseEtag = (value) => (value || '').replace(/^W\//, '').replace(/^"|"$/g, '');

/**
 * Opens the extraction, from a local file when one is given and over the network
 * otherwise. Returns an `openSource(offset)` that yields the body from that byte
 * onwards, plus the ETag and size to record.
 */
async function openExtraction(args) {
  if (args.extractionSource) {
    const { size } = fs.statSync(args.extractionSource);
    return {
      // The pin is *not* verified for a local file, and the artefact says so
      // rather than claiming a pin it did not check. A build from a local source
      // is for trying out a pruning rule; it is not a candidate for committing,
      // and the artefact it writes says that in its own metadata.
      etag: null,
      local: true,
      lastModified: null,
      totalBytes: size,
      // Honours the offset for the same reason the network path does. A local
      // read is not expected to fail and be retried, but if it were, resuming
      // from zero would re-add every Sense it had already recorded.
      openSource: (offset = 0) => fs.createReadStream(args.extractionSource, { start: offset })
    };
  }

  // A HEAD request first: it carries the ETag without transferring 3.3 GB, and
  // it is the check that stops a rebuild against a moved file.
  const head = await fetch(SOURCES.wiktionary.url, {
    method: 'HEAD',
    headers: WIKTIONARY_HEADERS
  });
  if (!head.ok) {
    throw new Error(`Extraction HEAD failed: HTTP ${head.status}`);
  }

  const etag = normaliseEtag(head.headers.get('etag'));
  const lastModified = head.headers.get('last-modified') || SOURCES.wiktionary.lastModified;
  const totalBytes = Number(head.headers.get('content-length')) || SOURCES.wiktionary.bytes;

  if (args.expectEtag && etag !== args.expectEtag) {
    throw new Error(
      `Extraction ETag is ${etag}, expected ${args.expectEtag}. ` +
      'The upstream file has moved; re-pin SOURCES and record the deviation.'
    );
  }
  if (totalBytes !== SOURCES.wiktionary.bytes) {
    throw new Error(
      `Extraction is ${totalBytes} bytes, expected ${SOURCES.wiktionary.bytes}.`
    );
  }

  return {
    etag,
    lastModified,
    totalBytes,
    openSource: async (offset) => {
      const headers = { ...WIKTIONARY_HEADERS };
      if (offset > 0) headers.range = `bytes=${offset}-`;

      const response = await fetch(SOURCES.wiktionary.url, { headers });
      if (!response.ok) {
        throw new Error(`Extraction fetch failed at byte ${offset}: HTTP ${response.status}`);
      }
      // A server that ignores Range answers 200 with the whole file, which
      // would duplicate every line already processed.
      if (offset > 0 && response.status !== 206) {
        throw new Error(
          `Extraction server ignored Range at byte ${offset} (HTTP ${response.status})`
        );
      }
      return response.body;
    }
  };
}

// --- Serialisation ------------------------------------------------------

/**
 * Prunes one headword's Senses down to the ones worth showing, in the order to
 * show them.
 *
 * Inflection Senses go last rather than being dropped: "walked" has a real
 * Definition *and* a form-of note, and both are true, but only one of them
 * answers the reader who selected the word.
 *
 * Returns null when nothing real remains, which is the signal for
 * `resolveInflections` to look up the headword the inflection points at.
 */
function prune(senses) {
  const inflections = [];
  const real = [];
  for (const sense of senses) {
    (isInflection(sense.definitions[0]) ? inflections : real).push(sense);
  }
  if (!real.length) return null;
  return [...real, ...inflections].slice(0, BUDGET.senses);
}

/**
 * Points a form-of-only headword at the Senses of the headword it inflects.
 *
 * This is the difference between shipping a dictionary and shipping a
 * dictionary with holes in it. The frequency list is full of inflected forms -
 * "did", "told", "kids", "sighs" are all in its top 20,000 - and Wiktionary
 * files each of them as a bare form-of line with no Definition of its own. So
 * Several thousand of the cut-off resolve to nothing but "simple past of do", and a reader
 * selecting "did" or "told" would have been told what those words are forms of
 * rather than what they mean. Dropping those headwords instead would have
 * removed words a reader selects constantly, which is a worse failure than a
 * redirect, so they are resolved to the headword's own Senses.
 *
 * A form-of whose target is not itself in the cut-off is dropped, because there
 * is nothing to point at.
 */
function resolveInflections(headwords) {
  const resolved = new Map();

  for (const [word, senses] of headwords) {
    const kept = prune(senses);
    if (kept) {
      resolved.set(word, kept);
      continue;
    }

    // Every Sense is a form-of note, so find the headword they point at. All of
    // them should agree; where they do not, the first is taken, because there is
    // no principled way to rank "plural of X" against "third-person of Y".
    const target = senses
      .map(sense => inflectionTarget(sense.definitions[0]))
      .find(Boolean);
    if (!target) continue;

    const targetSenses = headwords.get(target);
    if (!targetSenses) continue;
    const targetKept = prune(targetSenses);
    if (!targetKept) continue;

    resolved.set(word, targetKept);
  }

  return resolved;
}

/**
 * The artefact's `entries`, pruned and in a stable order.
 *
 * Keys are sorted rather than left in stream order, so the file does not depend
 * on the order the upstream extraction happens to emit words in.
 */
function buildEntries(headwords) {
  const resolved = resolveInflections(headwords);
  const keys = [...resolved.keys()].sort();
  const entries = {};
  for (const key of keys) {
    entries[key] = resolved.get(key);
  }
  return entries;
}

function serialise(entries, metadata) {
  return JSON.stringify({ meta: metadata, entries });
}

function gzip(buffer) {
  // level 9 and a zeroed mtime: the same input has to give the same bytes.
  return zlib.gzipSync(buffer, { level: 9, mtime: 0 });
}

// --- Entry point --------------------------------------------------------

function parseArgs(argv) {
  const args = { buildDate: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--build-date') args.buildDate = argv[++i];
    else if (flag === '--expect-etag') args.expectEtag = argv[++i];
    else if (flag === '--candidate-source') args.candidateSource = argv[++i];
    else if (flag === '--extraction-source') args.extractionSource = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else throw new Error(`Unknown flag: ${flag}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.buildDate)) {
    throw new Error(`--build-date must be YYYY-MM-DD, got ${args.buildDate}`);
  }
  return args;
}

async function loadCandidates(args) {
  if (args.candidateSource) {
    return fs.readFileSync(args.candidateSource, 'utf8');
  }
  const response = await fetch(SOURCES.frequencyWords.url);
  if (!response.ok) {
    throw new Error(`Frequency list fetch failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  const actual = Buffer.byteLength(text);
  if (actual !== SOURCES.frequencyWords.bytes) {
    throw new Error(
      `Frequency list is ${actual} bytes, expected ${SOURCES.frequencyWords.bytes}. ` +
      'The pin has moved.'
    );
  }
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ? path.resolve(args.out) : OUT_PATH;

  process.stderr.write('Fetching the pinned frequency list...\n');
  const frequencyText = await loadCandidates(args);
  const coverage = measureCoverage(frequencyText);
  const candidates = selectCandidates(frequencyText, BUDGET.candidates);
  if (candidates.length < BUDGET.candidates) {
    throw new Error(
      `Only ${candidates.length} candidates found, expected ${BUDGET.candidates}.`
    );
  }
  const tokenCoverage = coverage.covered(BUDGET.candidates);
  process.stderr.write(
    `  ${coverage.candidates} candidates, keeping the top ${candidates.length} ` +
    `(${(tokenCoverage * 100).toFixed(2)}% of word tokens)\n`
  );

  const started = Date.now();
  const { openSource, etag, lastModified, totalBytes, local } = await openExtraction(args);
  process.stderr.write(
    `  ${local ? 'local file' : `ETag ${etag}`}, ${totalBytes} bytes\n`
  );

  const accumulator = await streamWithResume(
    openSource,
    candidates,
    totalBytes,
    progress => {
      const mb = (progress.bytes / 1e6).toFixed(0);
      const elapsed = Math.max(1, (Date.now() - started) / 1000);
      const rate = (progress.bytes / 1e6 / elapsed).toFixed(1);
      const percent = (progress.bytes / totalBytes * 100).toFixed(1);
      process.stderr.write(
        `  ${percent}% ${mb}/${(totalBytes / 1e6).toFixed(0)} MB, ` +
        `${progress.lines} lines, ${progress.headwords.size} headwords, ${rate} MB/s` +
        `${progress.note ? ` (${progress.note})` : ''}\n`
      );
    }
  );

  process.stderr.write(
    `  done in ${Math.round((Date.now() - started) / 1000)}s\n`
  );

  const { headwords, lines, parsed } = accumulator;
  // Pruned before the count, because a headword whose every Sense is an
  // inflection is not in the artefact, and the coverage figure has to describe
  // the artefact rather than the intermediate map.
  const entries = buildEntries(headwords);
  const found = Object.keys(entries).length;

  const metadata = {
    buildDate: args.buildDate,
    headwordCount: found,
    candidateCount: candidates.length,
    // The coverage figure a future refresh compares itself against. The misses
    // are the design: they fall through to the live provider.
    coverage: found / candidates.length,
    tokenCoverage,
    budget: BUDGET,
    sources: {
      frequencyWords: SOURCES.frequencyWords.url,
      wiktionary: {
        url: SOURCES.wiktionary.url,
        // Null for a build from a local extraction file, because no ETag was
        // checked. Recording the pinned one anyway would make an unverified
        // artefact claim a provenance it does not have.
        etag,
        lastModified,
        wiktextractCommit: local ? null : SOURCES.wiktionary.wiktextractCommit
      }
    },
    licence: 'Wiktionary content is CC BY-SA 4.0; see docs/dictionary-refresh.md'
  };

  const json = serialise(entries, metadata);
  const gz = gzip(Buffer.from(json, 'utf8'));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, gz);

  process.stderr.write(
    `Wrote ${outPath}\n` +
    `  ${lines} lines read, ${parsed} parsed\n` +
    `  ${found}/${candidates.length} headwords ` +
    `(${(metadata.coverage * 100).toFixed(1)}% coverage)\n` +
    `  ${(json.length / 1e6).toFixed(1)} MB expanded, ${(gz.length / 1e6).toFixed(2)} MB compressed\n`
  );
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SOURCES,
  buildEntries,
  createAccumulator,
  createLineSplitter,
  gzip,
  isInflection,
  mayContainCandidate,
  inflectionTarget,
  measureCoverage,
  normaliseEtag,
  recordLine,
  selectCandidates,
  senseKey,
  serialise,
  toSenses
};

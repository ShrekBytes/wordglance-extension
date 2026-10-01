/*
  The disclosure matches the code.

  Every host the extension can reach is named in the reader-facing documents, and
  nothing is named there that it cannot reach. ADR-0004 requires the listing to
  name every third party that receives the selected word,
  docs/dictionary-refresh.md puts the CC BY-SA credit the bundled data owes in
  the listing and in the settings, and issue #14 puts the same disclosure inside
  the settings a reader already has open. All three are obligations, and all
  three are the kind of thing that rots silently: a host added to the manifest is
  a working code change, so it is easy to make and easy not to write down.

  So this reads manifest.json rather than a list typed out again here. A
  permission added without a line in every document fails `npm test`.
*/

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const listing = readFileSync(path.join(root, 'firefox-store-description.md'), 'utf8');
const settings = readFileSync(path.join(root, 'popup.html'), 'utf8');
const background = readFileSync(path.join(root, 'background.js'), 'utf8');

// Every script and stylesheet the extension loads, read rather than listed, so
// a file added to `manifest.json` - or to the settings page it points at -
// cannot go unexamined here. A hand-typed file list is a fourth declaration of
// what the extension contains, and ADR-0006 is about that class of
// disagreement.
//
// The endpoints are named in `shared-constants.js`, but Commons is not: the
// file name a recording is played from is built in `wiktionary.js`, and a test
// reading only the constants would not see that the permission behind it is
// doing anything.
const popup = manifest.browser_action.default_popup;
const shipped = [
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap(content => content.js),
  popup,
  // What the settings page pulls in, which the manifest does not enumerate. The
  // stylesheet is named there and nowhere else, so a test that stops at the
  // manifest would never see it.
  ...[...readFileSync(path.join(root, popup), 'utf8')
    .matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map(([, file]) => file)
]
  .map(file => readFileSync(path.join(root, file), 'utf8'));

// The hosts the extension holds a permission for. Everything else it fetches is
// a file in its own package, which leaves nobody's machine.
const hosts = manifest.permissions
  .filter(permission => permission.startsWith('https://'))
  .map(permission => new URL(permission).host);

// Every host named by a URL literal in a shipped script, which is the set the
// code can actually reach.
const reachable = shipped.flatMap(source =>
  (source.match(/'https:\/\/[^']+'/g) || []).map(url => new URL(url.slice(1, -1)).host)
);

// The order a selected word's requests actually leave the machine in, which is
// not the order the manifest groups its permissions in.
//
// It is two chains, run in sequence: the Definition Field is resolved and
// rendered before the Translation Field is even asked for, so a rare word
// reaches the live provider and the thesaurus before it ever reaches
// Wiktionary. Presenting the services as one list beginning with Wiktionary -
// which is what these documents used to do, and what the order test here used
// to enforce - is true for a common word, which the bundle answers with no
// request at all, and false for every other one.
//
// Commons is absent from this list on purpose: it is reached only when the
// reader presses the pronounce control, and never as part of a Lookup. Naming
// it in a sequence would imply a request the extension does not make.
const LOOKUP_ORDER = [
  'freedictionaryapi.com',
  'api.datamuse.com',
  'en.wiktionary.org',
  'clients5.google.com',
  'api.mymemory.translated.net',
  'www.bing.com'
];

// The three places a reader is told where their word goes. The settings are the
// one that cannot rot unnoticed, because a reader who has already installed
// never has to open either of the other two.
const documents = [
  ['the README', readme],
  ['the store listing', listing],
  ['the settings', settings]
];

test('the manifest holds a host permission for every service the code fetches', () => {
  // The guard against a call site with no permission behind it, which fails at
  // runtime in a browser and nowhere else.
  for (const host of reachable) {
    assert.ok(
      hosts.includes(host),
      `${host} is called by the code but has no host permission in manifest.json`
    );
  }
});

test('the manifest holds no host permission the code cannot reach', () => {
  // The other direction, and the one a dead host survives. The two services this
  // manifest replaced - `api.dictionaryapi.dev` and a Heroku translation
  // endpoint - were single anonymous maintainers, and both died. A permission
  // left behind for either keeps asking the reader for access to a host the
  // extension never contacts, which is the kind of permission an add-on review
  // reads as overreach rather than as a leftover.
  for (const host of hosts) {
    assert.ok(
      reachable.includes(host),
      `${host} has a host permission in manifest.json but no code fetches it. ` +
      'Remove the permission, or add the call site that needs it.'
    );
  }
});

test('the chain and the manifest name the same set of hosts', () => {
  // The two are declared independently - the manifest by whoever added a
  // provider, the chain here by whoever documented it - so the check that
  // keeps them honest is the one that compares them. A provider added to the
  // code and permissioned but never added here is a service every document
  // silently omits, which is the failure this whole file exists to catch.
  for (const host of LOOKUP_ORDER) {
    assert.ok(
      reachable.includes(host),
      `the chain names ${host} but no code fetches it`
    );
  }
  for (const host of hosts) {
    assert.ok(
      LOOKUP_ORDER.includes(host) || host === 'commons.wikimedia.org',
      `${host} is permissioned but is in neither the chain nor the pronunciation ` +
      'lookup, so no document can be shown to name it'
    );
  }
});

test('the background script fetches nothing that is not a named endpoint', () => {
  // Every URL the background builds is one of the constants. A URL concatenated
  // from a literal here - in either quote style - would be a host no document
  // names, and the check above would not see it either.
  for (const literal of background.match(/['`]https:\/\/[^'`]+\/?['`]/g) || []) {
    assert.fail(`background.js names a host directly: ${literal}. Add it to API_ENDPOINTS.`);
  }
});

for (const [name, document] of documents) {
  test(`${name} names every host the extension can reach`, () => {
    for (const host of hosts) {
      assert.ok(
        document.includes(host),
        `${name} does not name ${host}, which receives the word a reader selects`
      );
    }
  });

  test(`${name} no longer names a service the extension cannot reach`, () => {
    // The dictionary service that died in 2.5.0 and was replaced in 3.6.0. It
    // is the service every document used to promise, and a reader who installs
    // expecting it is entitled to know it is gone.
    assert.ok(
      !document.includes('dictionaryapi.dev'),
      `${name} still names the dead dictionary service`
    );
  });

  test(`${name} names the services in the order a Lookup reaches them`, () => {
    // A reader reading down the list should be reading the order their word
    // leaves the machine, so the claim "only when the ones before it had no
    // answer" is checkable rather than decorative. Matched on the host rather
    // than on the service's name, because a host is unique and a name is not -
    // "Google" is a word, and so is "Bing" - and the first mention of each is
    // the one a reader meets first.
    const positions = LOOKUP_ORDER.map(host => document.indexOf(host));

    for (const [i, position] of positions.entries()) {
      assert.ok(position > -1, `${name} does not list ${LOOKUP_ORDER[i]}`);
      if (i > 0) {
        assert.ok(
          position > positions[i - 1],
          `${name} lists ${LOOKUP_ORDER[i]} before ${LOOKUP_ORDER[i - 1]}. The ` +
          'Definition Field is resolved before the Translation Field is asked for.'
        );
      }
    }
  });

  test(`${name} credits the licence the bundled data carries`, () => {
    // A share-alike licence with a real attribution obligation rather than a
    // formality: docs/dictionary-refresh.md puts the credit in the listing and
    // in the settings, and the extension's own licence does not discharge it.
    // The extraction tooling is named with it, because the data was made by
    // running that over Wiktionary and not by Wiktionary alone.
    for (const credit of ['kaikki.org', 'wiktextract', 'CC BY-SA 4.0']) {
      assert.ok(document.includes(credit), `${name} does not credit ${credit}`);
    }
  });

  test(`${name} does not claim WordGlance runs the services it calls`, () => {
    // It ran none of them. "Our translation API" was never true of a project
    // with no server, and a disclosure that overstates what the author controls
    // is a disclosure a reader cannot rely on.
    assert.ok(
      !/our translation API|our dictionary API/i.test(document),
      `${name} claims an API WordGlance does not run`
    );
    assert.ok(
      /no servers/i.test(document),
      `${name} does not say that WordGlance runs no server of its own`
    );
  });

  test(`${name} says a fallback Translation is rougher than a curated one`, () => {
    // The chain returns one word where Wiktionary would have offered several to
    // choose between, and ADR-0003 makes the choice between formal and
    // colloquial the point. A reader who cannot tell a fallback answer from a
    // curated one is being asked to trust a difference they were never shown.
    assert.ok(
      /rougher|fallback/i.test(document),
      `${name} does not distinguish a fallback Translation from a curated one`
    );
  });

  test(`${name} promises a Lookup of one word, not a translation of a passage`, () => {
    // The phrase-translation path is gone, and the trigger does not appear for a
    // multi-word selection at all, so a document promising it is describing a
    // feature that no longer exists - and a reader who selects a sentence and
    // gets no button has been told the wrong thing.
    //
    // The claims are listed as they were written rather than as a pattern. A
    // pattern broad enough to catch them also catches the FAQ entry that asks
    // whether sentences can be translated in order to answer "no", and a test
    // that fails on a denial of the thing it wants is a test that gets deleted
    // rather than fixed.
    for (const promise of [
      /select(?:ing)? any text/i,
      /any text on any website/i,
      /word or phrase/i,
      /drag for phrases/i,
      /5 words/i,
      /100 characters/i,
      /for longer passages/i,
      /translate to \d+\+? languages instantly/i
    ]) {
      assert.doesNotMatch(document, promise, `${name} still promises: ${promise}`);
    }

    // And the positive claim, because removing the old words is not the same as
    // describing what the extension does. CONTEXT.md is explicit that a Lookup
    // concerns exactly one headword, and this is where a reader meets that -
    // in the settings as much as in either document, since a reader who has
    // installed never has to open the other two.
    //
    // The HTML wraps at a column, so the phrase is allowed to straddle a line
    // break; requiring it on one line would be a test of the editor's
    // preferences rather than of the claim.
    assert.match(
      document,
      /Lookup\s+is\s+about[^.]{0,60}\b(one|single)\b[^.]{0,20}\bword\b/i,
      `${name} does not say that a Lookup is about a single word`
    );
  });
}

// The settings are left out here on purpose: a Chromium reader never sees them,
// and this is the one claim that exists to catch a reader arriving from the
// retired userscript looking for where to go next.
for (const [name, document] of [['the store listing', listing], ['the README', readme]]) {
  test(`${name} points a Chromium reader here rather than at a userscript`, () => {
    // ADR-0004 retires the sibling userscript: it fetches from the page, so CORS
    // applies and every replacement endpoint would have to serve
    // `Access-Control-Allow-Origin`. Sending a reader to it as though it were a
    // working alternative is the one thing worse than saying nothing.
    //
    // The link has to be in the sentence that mentions the userscript. Asserting
    // that the document mentions this repository *anywhere* would pass on the
    // Firefox badge, and the sentence about the userscript could be deleted
    // entirely without this failing - which is the one edit that matters here.
    const mentionsUserscript = /userscript/i;
    assert.ok(
      mentionsUserscript.test(document),
      `${name} never mentions the userscript, so no reader is sent from it`
    );
    assert.match(
      document,
      /userscript[^\n]*\n?[^\n]*(archiv|retired|no longer)|(archiv|retired|no longer)[^\n]*\n?[^\n]*userscript/i,
      `${name} does not say the userscript is archived`
    );
    assert.ok(
      /wordglance-extension/i.test(document),
      `${name} does not point a reader at this extension`
    );
  });
}

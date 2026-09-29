/*
  The disclosure matches the code.

  Every host the extension can reach is named in the reader-facing documents, and
  nothing is named there that it cannot reach. ADR-0004 requires the listing to
  name every third party that receives the selected word, and
  docs/dictionary-refresh.md puts the CC BY-SA credit the bundled data owes in
  the listing and the settings. Both are obligations, and both are the kind of
  thing that rots silently: a host added to the manifest is a working code
  change, so it is easy to make and easy not to write down.

  So this reads manifest.json rather than a list typed out again here. A
  permission added without a line in both documents fails the build.
*/

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const listing = readFileSync(path.join(root, 'firefox-store-description.md'), 'utf8');
const constants = readFileSync(path.join(root, 'shared-constants.js'), 'utf8');
const background = readFileSync(path.join(root, 'background.js'), 'utf8');

// The hosts the extension holds a permission for. Everything else it fetches is
// a file in its own package, which leaves nobody's machine.
const hosts = manifest.permissions
  .filter(permission => permission.startsWith('https://'))
  .map(permission => new URL(permission).host);

test('the manifest holds a host permission for every service the code fetches', () => {
  // The guard against a call site with no permission behind it, which fails at
  // runtime in a browser and nowhere else.
  for (const endpoint of constants.match(/'https:\/\/[^']+'/g) || []) {
    const host = new URL(endpoint.slice(1, -1)).host;
    assert.ok(
      hosts.includes(host),
      `${host} is called by the code but has no host permission in manifest.json`
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

for (const [name, document] of [['README', readme], ['the store listing', listing]]) {
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
    // is the service both documents used to promise, and a reader who installs
    // expecting it is entitled to know it is gone.
    assert.ok(
      !document.includes('dictionaryapi.dev'),
      `${name} still names the dead dictionary service`
    );
  });
}

test('the store listing does not claim WordGlance runs the services it calls', () => {
  // It ran none of them. "Our translation API" was never true of a project with
  // no server, and a disclosure that overstates what the author controls is a
  // disclosure a reader cannot rely on.
  assert.ok(
    !/our translation API|our dictionary API/i.test(listing),
    'the store listing claims an API WordGlance does not run'
  );
  assert.ok(
    /no servers/i.test(listing),
    'the store listing does not say that WordGlance runs no server of its own'
  );
});

test('the store listing credits the licence the bundled data carries', () => {
  // A share-alike licence with a real attribution obligation, which
  // docs/dictionary-refresh.md says is owed in the listing and in the settings.
  for (const credit of ['kaikki.org', 'wiktextract', 'CC BY-SA 4.0']) {
    assert.ok(listing.includes(credit), `the store listing does not credit ${credit}`);
  }
});

test('the store listing names the services in the order the chain asks them', () => {
  // A reader reading the list top to bottom should be reading the order a word
  // actually travels in, so the claim "only when the ones before it had no
  // answer" is checkable rather than decorative.
  const chain = [
    'Wiktionary',
    'Wikimedia Commons',
    'Free Dictionary API',
    'Datamuse',
    'Google',
    'MyMemory',
    'Bing'
  ];
  const positions = chain.map(service => listing.indexOf(`**${service}**`));

  for (const [i, position] of positions.entries()) {
    assert.ok(position > -1, `the store listing does not list ${chain[i]}`);
    if (i > 0) {
      assert.ok(
        position > positions[i - 1],
        `the store listing lists ${chain[i]} before ${chain[i - 1]}`
      );
    }
  }
});

test('the store listing says a fallback Translation is rougher than a curated one', () => {
  // The chain returns one word where Wiktionary would have offered several to
  // choose between, and ADR-0003 makes the choice between formal and colloquial
  // the point. A reader who cannot tell a fallback answer from a curated one is
  // being asked to trust a difference they were never shown.
  assert.ok(
    /rougher|fallback/i.test(listing),
    'the store listing does not distinguish a fallback Translation from a curated one'
  );
});

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function createBackground(fetchImpl) {
  const noopEvent = { addListener() {} };
  const context = vm.createContext({
    AbortController,
    URLSearchParams,
    console,
    fetch: fetchImpl,
    // Cache persistence is irrelevant to these unit tests; immediate no-op timers
    // also prevent the debounced cache save from holding the test process open.
    setTimeout: () => 0,
    clearTimeout() {},
    browser: {
      storage: {
        local: {
          async get() { return {}; },
          async set() {}
        },
        onChanged: noopEvent
      },
      runtime: {
        onMessage: noopEvent,
        onStartup: noopEvent,
        onSuspend: noopEvent
      }
    }
  });

  for (const file of ['shared-constants.js', 'shared-utilities.js', 'background.js']) {
    vm.runInContext(readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }

  return context;
}

test('uses Datamuse when the primary dictionary API is unavailable', async () => {
  const requestedUrls = [];
  const context = createBackground(async url => {
    requestedUrls.push(url);

    if (url.startsWith('https://api.dictionaryapi.dev/')) {
      return response('error code: 522', 522);
    }
    if (url.includes('rel_syn=')) {
      return response([{ word: 'bright' }, { word: 'intelligent' }]);
    }
    if (url.includes('rel_ant=')) {
      return response([{ word: 'dull' }]);
    }
    return response([{
      word: 'brilliant',
      defs: [
        'adj\tHighly intelligent.',
        'adj\tOf surpassing excellence; magnificent.'
      ]
    }]);
  });

  const result = await vm.runInContext("fetchDefinition('Brilliant')", context);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    defs: [
      { definition: 'Highly intelligent.', partOfSpeech: 'adjective', example: '' },
      { definition: 'Of surpassing excellence; magnificent.', partOfSpeech: 'adjective', example: '' }
    ],
    synonyms: ['bright', 'intelligent'],
    antonyms: ['dull'],
    audio: ''
  });
  assert.equal(requestedUrls.length, 4);
  assert.match(requestedUrls[1], /api\.datamuse\.com\/words/);
});

test('keeps using the richer primary response when it is healthy', async () => {
  let requestCount = 0;
  const context = createBackground(async () => {
    requestCount += 1;
    return response([{
      phonetics: [{ audio: '//audio.example/brilliant.mp3' }],
      meanings: [{
        partOfSpeech: 'adjective',
        synonyms: ['excellent'],
        antonyms: ['dull'],
        definitions: [{
          definition: 'Very impressive or successful.',
          example: 'A brilliant performance.',
          synonyms: [],
          antonyms: []
        }]
      }]
    }]);
  });

  const result = await vm.runInContext("fetchDefinition('Brilliant')", context);

  assert.equal(requestCount, 1);
  assert.equal(result.defs[0].definition, 'Very impressive or successful.');
  assert.equal(result.audio, 'https://audio.example/brilliant.mp3');
});

test('reports a missing word accurately when neither provider has it', async () => {
  const context = createBackground(async url => {
    if (url.startsWith('https://api.dictionaryapi.dev/')) return response({}, 404);
    return response([]);
  });

  await assert.rejects(
    vm.runInContext("fetchDefinition('notaword')", context),
    { message: 'Definition not found' }
  );
});

/*
  Test harness for the background script.

  Loads the real background scripts into a node:vm context with an injected
  network and a stubbed extension API, and hands back a `send` function that
  drives the real message contract.

  The registered onMessage listener is captured rather than stubbed, so a test
  sends a real message and asserts on the payload that comes back. Nothing in
  the tests calls a function the background defines internally.
*/

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');

const BACKGROUND_SCRIPTS = ['shared-constants.js', 'shared-utilities.js', 'background.js'];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function notFound() {
  return jsonResponse({ success: false, error: 'Not found' }, 404);
}

// Records every URL the background asks for, so a test can assert both what came
// back and what was requested. The handler is called with (url, index) and its
// result is returned as the response; a handler that returns nothing produces a
// 404, and throwing from one fails the test, because a request nobody expected
// is a failure rather than a silent miss.
//
// The packaged dictionary is not part of this: the extension reads it out of its
// own package, so it is served here rather than by the handler, and it is the one
// URL that is not a request leaving the reader's machine.
//
// It is served as a real `Response` while the handler's responses are hand-rolled
// stubs, because the extension pipes this one through a DecompressionStream and
// a stub cannot carry a body. The two shapes are the two things a provider
// response and a packaged file actually are.
function createNetwork(handler) {
  const urls = [];
  let packaged = null;

  const fetchImpl = async (url) => {
    const target = String(url);
    urls.push(target);
    if (packaged && target === packaged.url) {
      return new Response(packaged.bytes());
    }
    const result = handler ? await handler(target, urls.length - 1) : undefined;
    return result === undefined ? notFound() : result;
  };

  return {
    fetchImpl,
    urls,
    // `bytes` is a thunk so the 5 MB artefact is only read by a test that
    // actually asks the background for a Definition.
    servePackage(url, bytes) {
      packaged = { url, bytes };
    }
  };
}

// In-memory stand-in for browser.storage.local, so a test can assert that a
// message persisted (or cleared) state rather than only that it returned.
function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    local: {
      async get(keys) {
        if (keys == null) return { ...data };
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) {
          if (Object.hasOwn(data, key)) out[key] = data[key];
        }
        return out;
      },
      async set(items) {
        Object.assign(data, items);
      }
    }
  };
}

/**
 * Loads the background scripts and returns a handle for driving them.
 *
 * @param {object} [options]
 * @param {(url: string, index: number) => Promise<object>|object} [options.fetch] network injection
 * @param {object} [options.storage] initial browser.storage.local contents
 * @param {object|false} [options.dictionary] the packaged dictionary to serve.
 *   Omitted, the committed artefact is served, so a test describes the data the
 *   extension really ships. Pass an object to control the headwords under test,
 *   or `false` to make the packaged read fail.
 */
function createBackground({ fetch: handler, storage = {}, dictionary } = {}) {
  const noopEvent = { addListener() {} };
  const network = createNetwork(handler);
  const store = createStorage(storage);

  const context = vm.createContext({
    AbortController,
    URLSearchParams,
    // The packaged dictionary is a real gzipped response, read through a real
    // stream, so the decompression path under test is the one that ships.
    DecompressionStream,
    Response,
    console,
    fetch: network.fetchImpl,
    // Real timers, so the request timeout and the debounced cache save behave
    // as they do in the browser. `unref` is what stops a pending cache save from
    // holding the test process open after the last test has finished.
    setTimeout(fn, ms) {
      const id = setTimeout(fn, ms);
      if (typeof id.unref === 'function') id.unref();
      return id;
    },
    clearTimeout,
    browser: {
      storage: {
        local: store.local,
        onChanged: noopEvent
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            context.__listener = listener;
          }
        },
        onStartup: noopEvent,
        onSuspend: noopEvent
      }
    }
  });

  for (const file of BACKGROUND_SCRIPTS) {
    vm.runInContext(readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }

  assert.equal(typeof context.__listener, 'function', 'background registered no message listener');

  // Read out of the loaded scripts rather than repeated here, so the harness
  // serves the path the extension actually reads and a rename cannot leave the
  // two quietly disagreeing.
  const bundleUrl = vm.runInContext('BUNDLED_DICTIONARY', context);
  network.servePackage(bundleUrl, () => {
    if (dictionary === false) return new Response('not packaged', { status: 404 });
    if (dictionary !== undefined) {
      return zlib.gzipSync(Buffer.from(JSON.stringify(dictionary), 'utf8'));
    }
    return readFileSync(path.join(root, bundleUrl));
  });

  return {
    /**
     * Sends a real message through the background's registered listener and
     * returns the payload as a plain object.
     *
     * The round-trip through JSON is not cosmetic: in the browser the payload
     * crosses a structured-clone boundary into the caller's realm, so returning
     * the vm's own object would compare unequal to a literal in a test for a
     * reason the extension never has.
     */
    send(message) {
      return Promise.resolve(context.__listener(message)).then(payload => (
        payload === undefined ? payload : JSON.parse(JSON.stringify(payload))
      ));
    },
    storage: store,
    /** The packaged dictionary's URL, as the background script spells it. */
    bundleUrl,
    /** URLs requested, in order. Grows as the test awaits `send`. */
    get requestedUrls() {
      return [...network.urls];
    },
    /**
     * URLs requested over the network, in order - everything the background
     * asked for except the dictionary in its own package. A test asserting that
     * a Lookup is offline asserts on this rather than on `requestedUrls`,
     * because reading a file that ships with the extension is not a request.
     */
    get networkUrls() {
      return network.urls.filter(url => url !== bundleUrl);
    }
  };
}

module.exports = { createBackground, jsonResponse, notFound };

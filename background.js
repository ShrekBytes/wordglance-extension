/*
  Background Script: Network proxy for WordGlance extension
  Provides fetch functionality for content scripts when direct API calls are blocked
*/

// Optional network proxy if target sites block XHR from content script.
// Content script can use runtime.sendMessage({type:'fetch', url, init}) and receive {ok,status,headers,text}.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "WORDGLANCE_FETCH") {
    const { url, init } = msg;
    return fetch(url, init)
      .then(async (res) => ({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Array.from(res.headers.entries()),
        text: await res.text()
      }))
      .catch((e) => ({ ok: false, error: String(e) }));
  }
});

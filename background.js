/*
  Background: context menu + keyboard command + optional fetch proxy
*/

const MENU_ID_SETTINGS = "wordglance-settings";

browser.runtime.onInstalled.addListener(() => {
  // Create context menu to open settings UI in-page via content script
  browser.menus.create({
    id: MENU_ID_SETTINGS,
    title: "WordGlance Settings",
    contexts: ["all"]
  });
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID_SETTINGS && tab && tab.id) {
    browser.tabs.sendMessage(tab.id, { type: "WORDGLANCE_OPEN_SETTINGS" }).catch(() => {});
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (command === "wordglance-open-settings") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, { type: "WORDGLANCE_OPEN_SETTINGS" }).catch(() => {});
    }
  }
});

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

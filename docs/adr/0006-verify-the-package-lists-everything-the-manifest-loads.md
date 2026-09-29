# Every file the extension loads is in the release build

The release workflow zips an explicit file list rather than the repository, so
`wiktionary.js` shipped in neither. It is loaded by `manifest.json` and read by
`background.js`, so a build without it is an extension whose background script
throws `WiktionaryUtils is not defined` the first time a reader asks for a
Translation — which is every Translation, and every pronunciation.

This is not the same failure as a missing `data/`, and the test written for
`data/` did not catch it: that one asks whether a directory is in the list,
while this one asks whether the list and the manifest agree. The manifest is
the declaration of what the background and content scripts load, and the workflow
is a second, hand-maintained declaration of what ships. Two declarations of the
same fact is a field for them to disagree in, and the disagreement is invisible
until a reader in a browser sees it.

So the file list is derived rather than typed: the test reads `background.scripts`,
every content script's `js`, and `browser_action.default_popup`, then follows the
settings page's own `src` and `href` to the stylesheet it pulls in. That last
hop is the reason this is not simply "everything in the manifest" — the manifest
names the settings page and only the page names `popup.css`, so a check derived
from the manifest alone would leave the one file it does not mention to a
hand-typed entry, which is the disagreement this ADR exists to close. Adding a
file the extension loads, without adding it to the workflow, now fails the build
rather than publishing a broken extension.

`tests/disclosure.test.js` derives the same set, for the same reason and with
the same follow-the-page hop: it needs to know which hosts the shipped code can
reach, and a hand-typed file list there would quietly drop the hosts of any
script added later.

This is the same reasoning the disclosure test uses for host permissions, one
layer over: a working code change is easy to make and easy not to write down
twice.

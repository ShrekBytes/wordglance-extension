# Every file the manifest loads is in the release build

The release workflow zips an explicit file list rather than the repository, so
`wiktionary.js` shipped in neither. It is loaded by `manifest.json` and read by
`background.js`, so a build without it is an extension whose background script
throws `WiktionaryUtils is not defined` the first time a reader asks for a
Translation — which is every Translation, and every pronunciation.

This is not the same failure as a missing `data/`, and the test written for
`data/` did not catch it: that one asks whether a directory is in the list,
while this one asks whether the list and the manifest agree. The manifest is
the single declaration of what the extension loads, and the workflow is a
second, hand-maintained declaration of what ships. Two declarations of the same
fact is a field for them to disagree in, and the disagreement is invisible until
a reader in a browser sees it.

So the file list is now derived from the manifest: the test reads
`background.scripts` and every content script's `js` and asserts each is zipped.
Adding a script to the manifest without adding it to the workflow fails the
build rather than publishing a broken extension.

This is the same reasoning `tests/disclosure.test.js` uses for host permissions,
one layer over: a working code change is easy to make and easy not to write
down twice.

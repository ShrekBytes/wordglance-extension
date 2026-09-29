# The background refuses a turned-off Field, and no reader is shown the refusal

`ERROR_MESSAGES.DEFINITIONS_DISABLED` and
`ERROR_MESSAGES.TRANSLATIONS_DISABLED` are unreachable reader-facing copy. The
content script checks the setting before it sends the message, and hides the
Field before it draws anything, so a reader who has turned Definitions or
Translations off sees a Tooltip with that Field absent — never a sentence
explaining why. The guards in `background.js` and the two strings behind them
stay anyway, and this ADR is what says so.

## Why they stay

The background's message listener is a contract, not a private helper. The
content script's own check is what keeps the work from starting, and the
background's is the one that cannot be skipped, because every caller of every
Field crosses it. The work either side of that line is a request to a provider
or a multi-megabyte read out of the package, so the setting is worth checking
at both the call site and the boundary — the first saves the request, the
second holds the contract whatever a future caller does. Deleting the guard
would not remove the risk, only the place the risk is currently caught.

Unreachable is the honest word for these two strings, and the reason to say it
out loud is that unreachable reader copy has already cost this project once. A
README claimed a reader was shown a third message when a Field was turned off.
They are shown nothing. Documentation describing an outcome no reader reaches
is the same defect as documentation describing one they never had, and the way
to keep it fixed is to record which messages answer the contract and leave the
reader-facing prose describing only what is on screen.

## What the cost is

Two strings, and two message types, that a reader cannot trigger. If the
content script's own check is ever removed — or a second caller appears that
does not carry it — the guard is already there and already tested, so nothing
breaks visibly; the Field comes back for a reader who turned it off, and that
is a defect the guard would have caught at the boundary instead.

## The third string in the same position

`ERROR_MESSAGES.INVALID_WORD` sits alongside these two and is unreachable for
the same reason, which is not obvious from the code that throws it.
`headwordKey` throws it, and both Fields refuse a multi-word selection with
it — but a phrase never reaches the background. The content script runs the
selection through `HeadwordUtils.normalize` and shows no trigger unless what
comes back is one headword, so the only way to reach the throw is a caller
that has skipped the same check. The two tests covering it cover the contract
for the same reason the two above do, and nothing about it changes here: it is
kept for the same reason and refused in the same place.

## How the suite says so

The tests covering the guards are named for the contract rather than for a
reader's experience, so nobody reading the suite concludes that a turned-off
Field is explained on screen. What they assert — that no request is issued —
is the part of the guard that has nothing to do with the wording.

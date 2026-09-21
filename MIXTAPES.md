# Mixtapes

`/mixtapes/` is a standalone frontend feature with its own JavaScript, stylesheet
and page. The collection links to it as “Listener mixtapes”; the build adds the
public directory.

## Pages

| URL | What it shows |
| --- | --- |
| `/mixtapes/` | The gallery: every published tape, newest first, 12 per page, with a **New mixtape** button and an empty state. |
| `/mixtapes/new` | An empty tape (no name, songs, drawing or clipart) to build and publish. |
| `/mixtapes/<12-character id>` | One published tape, playable, with “Copy link” and “Make your own version”. |
| `/mixtapes/#tape=…` | Older Base64 links still open; “Publish mixtape” turns one into a short, listed tape. |

**Every mixtape is public.** Publishing (`POST /mixtapes`) adds it to the gallery
(`GET /mixtapes?page=N`); there is no private or unlisted option, and no editing
or deletion. Tapes shared before the gallery existed are listed too.

## Labels

Each side has a hand-drawn label: bounded pen strokes (up to 60 strokes and
1,200 points in a 1000 × 240 box) drawn on a canvas. There is no typed label
field. Each side may also carry one **clipart** picture: the song covers'
character generator, stored only as a seed plus small trait numbers that the page
draws itself, so no image, SVG or HTML is ever stored. Clipart is drawn **wide**
(`songArtwork(song, { wide: true })`, a 1000 × 240 picture with the character in
the middle and the backdrop and confetti filling the rest), so it fills the whole
label rectangle on the deck, in the editor preview and on gallery cards. Handwriting,
if there is any, is written over it. Song covers stay square and are unchanged.
**Pre-draw Side A & B** fills any blank side with hand-lettered “SIDE A” / “SIDE B”
strokes and never overwrites a drawn label.

A side with neither drawing nor clipart, and any device without canvas and
pointer input, shows plain “Side A” / “Side B” text (clipart can still be
picked). Tapes made before this change may carry a typed label; it still shows
where nothing is drawn, but it can no longer be entered.

## Authored by

Like a song request, a tape has an optional **Authored by** name (up to 100
characters, trimmed). It is stored in the published tape as `authoredBy`, and a
blank name is left out entirely, so tapes without one keep their shape and link.
A new tape fills the field from the name remembered in this browser
(`yehry3:authored-by`, shared with the request form); editing it updates what is
remembered, and clearing it clears it. “Make your own version” drops the original
author and fills in your own name. The name shows on gallery cards (and in each
card's accessible name) and under the title of a published tape. The Chairlift
side must be deployed first: an older backend silently drops the field.

## Drafts

A draft lives in `sessionStorage` at `yehry3:mixtape:v1`, so a reload of the tab
that is editing keeps it. The gallery’s New button clears it first, so New is
always empty. “Make your own version” copies a published tape into a new draft.
Nothing is written to the browser’s long-term storage; an earlier
`localStorage` draft is simply ignored.

## Deploy order and rollback

The frontend needs Chairlift’s `GET /mixtapes` listing and the `art` label field.
Deploy Chairlift first. Publishing clipart to an older backend silently drops it.

Rollback: revert the frontend commit, then rebuild and deploy. The backend
additions are harmless to leave in place. Reverting the frontend keeps every
published `/mixtapes/<id>` link working, since the earlier page reads the same
snapshots (clipart just would not show).

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
field. Each side may also carry one **clipart** piece, an ID from a fixed list
(`star`, `heart`, `bolt`, `moon`, `note`, `sun`) that the page draws itself, so
no image, SVG or HTML is ever stored. Clipart can sit beside the drawing or be
the whole label. **Pre-draw Side A & B** fills any blank side with hand-lettered
“SIDE A” / “SIDE B” strokes and never overwrites a drawn label.

A side with neither drawing nor clipart, and any device without canvas and
pointer input, shows plain “Side A” / “Side B” text (clipart can still be
picked). Tapes made before this change may carry a typed label; it still shows
where nothing is drawn, but it can no longer be entered.

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

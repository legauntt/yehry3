# yehry3 · The listening room

A static Tony C music site with a MongoDB voting and request API in the sibling **chairlift** repository.

Requests support optional lyric sheets and per-link creative references or lyric imports.
See [lyrics and references](REQUEST-MATERIALS.md) for limits, privacy, testing and coordinated rollout.

| Route          | Behavior                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Both the Tony AI and Fear & Hunger catalogs; search, filters, vote sorting, Play all, Shuffle, seeking, previous/next and MP3 links |
| `/distonyc/`   | Password gate, initial idea, optional basis songs/direction follow-up, final confirmation, and request status                       |
| `/admin/`      | Separate admin login; paginated requests, filters/counts, priority, private notes, cancel/retry, production status, and history     |
| `/queue/details/?request=…` | Stable, shareable public status page for one privacy-filtered confirmed request |
| `/deetz/`      | Studio process guide and saved planning example, loaded from the authenticated API after the Distonyc login                        |
| `/fearhunger/` | Preserved original three-track page, MP3s and lyrics                                                                                |

`/distonyc/` is the request page; `/longtimecomin` and `/longtimecomin/` permanently redirect there. The local preview mirrors these redirects.

The site remains noindex. Existing audio files and URLs are preserved. The Tony AI tracks stream from their existing release URLs. Static `catalog.json` keeps listening available during API outages; voting is clearly disabled while offline.

yehry3.app is the default destination for new finished Tony/Troofs MP3s, including standalone songs. The old gatsby-opus `/tonyai` page is deprecated for new publications; keep its existing tracks and URLs working. `tonyai` remains the collection ID here, not a publication destination. Standalone additions use the existing GitHub release and Chairlift's safe catalog seed, with matching fallback metadata and lyrics; do not create artificial queue requests. Keep WAVs, A/B clips, stems and model assets local unless separately requested.

The three **Tony V7 Study** songs are experimental listening material. V7 is the default voice for new requests and remains experimental; V6 is still available. Saved requests retain their selected voice. Telephone Wire retains two brief vocal gaps around 2:16 and 2:18 (1.6 seconds total); The Last Light in the Station retains its complete 26.54-second instrumental outro. Their catalog issue notices remain visible. Technical verification is not a human listening judgment.

The refinements step opens on **Essentials**, with the voice selector and “What matters most?”. Its **Advanced** tab contains “What does it sound like?”, Lyrics & references, then Basis songs. Both tabs feed the same review; switching tabs keeps all entered values, and the active tab is remembered for that draft in the browser tab. Keyboard arrows, Home and End switch tabs; validation reveals the tab containing the field that needs attention.

Prompt details, request review and Backstage group the saved brief into **Essentials** and **Advanced** in that same order. Admin cards summarize the voice, custom sound, lyric mode/word count, reference count and basis songs before opening the brief. Supplied lyrics and saved reference content expand separately, with each reference’s purpose, note, source link and retrieval status. Anyone can read these materials after confirmation, including on existing requests. Public original-prompt pages load them from the individual request endpoint, even after publication; the polling queue and catalog lists stay compact. If the details API is unavailable, the saved catalog brief remains readable and the page explains that materials could not be loaded.

The request form includes a **V6 vs V7** comparison modal beside the voice selector: fresh preference-neutral selection, larger separately trained voice adapter, and the limited meaning of its roughly 0.6% reconstruction-loss improvement. The dialog supports keyboard dismissal, focus return and mobile scrolling. Listening views keep compact V6/V7 badges, with a distinct treatment for experimental V7, but do not repeat the comparison link.

## Run

Node 22 or later:

```sh
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:8080`. The server serves **only `dist/`**, supports MP3 seeking, and redirects directory routes. The build copies only public pages/assets; environment files, tools, tests, and backend source cannot enter the deployment.

Every build adds a small **Updated at** timestamp to each page's footer, using Pacific time with the correct PST/PDT abbreviation. It records the build time, so it changes on every deployment, including catalog publications and deployment reruns, and stays fixed when a visitor reloads the page.

The browser uses `http://127.0.0.1:3000/yehry3` locally and `https://chairlift.fly.dev/yehry3` in production. Change `assets/config.js` and the CSP together if the API host changes.

For a disposable end-to-end preview, install dependencies in sibling `../chairlift`, set `YEHRY3_ADMIN_PASSWORD` to a local test password, and run `node scripts/dev-api.mjs` in a second terminal. It seeds a temporary Mongo replica set and never connects to the existing database. Its first run downloads MongoDB. The request password is `wishbone`; choose a different admin password. Preview data disappears when it stops. `CHAIRLIFT_PATH` overrides the sibling location.

For the real API, follow [chairlift's setup and queue contract](../chairlift/yehry3/README.md). Configure the submission password, separate admin password and signing secret in the backend, then run its catalog seed. No credentials are placed in the public build.

## Behavior

- Remix availability appears on song cards and lyric pages. Verified checks expire after 48 hours;
  unavailable sources cannot be submitted. During a catalog/API outage, sources without current
  availability offer **Check remix availability** rather than claiming readiness.
- Attached remixes put **What should change?**, **What should stay?**, and **May the lyrics change?**
  in Essentials. The choice between retaining supplied words and allowing adaptation remains in the
  confirmed brief. The form explains that melody and timing may change.
- Published remixes link to their original on the lyric page. **Play original** and **Play remix**
  switch playback without overlap, retaining each recording's independent position. The original's
  direct lyric-page link, native audio controls, and mobile layout remain available.

The collection headline and main-page footers choose from 100 curated branding lines on each page load. The line stays fixed through playback, filtering and polling, and avoids the previous visit's line when session storage is available. This uses no API or generation call.

Mixtape shares now use `/mixtapes/<12-character-id>`. Chairlift stores an immutable snapshot in MongoDB; repeated sharing of identical content reuses its URL, while edits create a new snapshot. Old `#tape=` Base64 links still open and can be shortened with **Copy mixtape link**. Local drafts stay local until shared, and an API failure leaves the draft intact for retry. Deploy the matching Chairlift `/mixtapes` API first.

Each cassette side has its own text label and optional handwriting pad for a mouse, finger or stylus. Flip or automatic side changes display that side's label. Handwriting saves bounded pen strokes, with separate Undo / Use typed label controls per side; typed text remains accessible alongside the drawing. Both labels and their drawings survive reloads, short-link sharing and making a new version. Old drafts automatically gain empty side labels and retain their name and track order.

- **Mixtapes** has a cassette deck with play/pause, stop, previous/next, seeking and side flipping. Reels follow playback and respect reduced motion. Side A continues into B; clicking a track starts there. Moving or reordering the playing track preserves its audio and updates the following tracks. Removing that entry stops it. A searchable shelf shows durations and which side already contains a song; **Add a surprise mix** adds up to six unselected recordings, balancing side durations without replacing selections. Drafts stay in browser storage, and shared links retain a snapshot of the name, color and order. Existing links and drafts remain compatible. Mixtapes and Backstage have separate, consistent navigation links before and after page navigation.

The compact collection intro keeps the record artwork beside the text, including on mobile, so the tracks are closer to the top. **Listening activity** starts collapsed; opening it shows total listens, songs listened to, and the latest listen for every matching song across all pages. It stays open through filtering and automatic refresh, and starts collapsed on a new page load. These are global listener statistics, including when viewing a profile’s Saved songs. The **Most listened to** button inside selects that ordering directly; the always-visible sort dropdown offers the same option and preserves existing `?sort=plays` links. The totals follow search, collection, and saved-song filters, and update after recorded listening and automatic catalog refresh. Unavailable statistics show a dash rather than an invented zero.

- The main catalog shows 25 songs per page, with Previous/Next controls above and below the list and a shareable `?page=2` URL. Search, collection, sort, and saved-song changes return to page one. Refresh preserves the current page and playback. Play the collection, Shuffle, and the player's Previous/Next use the entire filtered collection across pages.
- Listening history starts September 15, 2026. Main-page and lyric-sheet players record a listen after 10 seconds of actual playback (or at least 90% of a completed recording shorter than 10 seconds). Opening pages, seeking, buffering, and pausing do not create extra plays. Chairlift counts at most once per browser/song per rolling 30 minutes, including cross-page visits, and stores a global `playCount` and `lastPlayedAt`. Rows and lyric sheets display these statistics; Most listened to, Least listened to, and Least recently played sorts help identify neglected songs. No listens recorded means none since tracking began, not never heard historically. No songs are hidden or removed automatically.
- Listening reports retry transient failures twice with the same request ID while the page remains open; prolonged outages or closed pages can lose reports without affecting audio. Direct MP3 downloads, external players, and the separate Fear & Hunger player are outside this initial tracking scope. Anonymous browser activity is an approximate usage measure. The server stores only aggregate song statistics and expiring hashed deduplication/rate keys, without raw IPs, profile names, or public visitor history. Deploy the matching Chairlift `/listens` API before this frontend.
- The hero record plays its short arrival spin after the page loads and becomes visible, including when Windows animation effects are off. Clicking it earlier takes control immediately. Reduced motion still disables the occasional automatic idle spins.
- Song ages use elapsed time from a real release timestamp, including across UTC midnight. Missing dates show **Age unavailable** until the API can supply them. Catalog refreshes preserve a song's position only after the visitor has scrolled into the list; a row visible beneath the introduction cannot pull the page down when rankings change. Native browser history/reload scroll restoration remains enabled.
- **Song plan** links open the saved musical plan beside the **Original prompt**: planned title, approach, vocal reference style, length, tempo, key, arrangement, lyrics, and any movements. Plans appear after planning finishes, before rendering; an open request sheet checks every 30 seconds while waiting. The same snapshot stays with the published song in the API and fallback catalog. Forty-three published requests were backfilled from matching saved plans and recording hashes; older songs without a saved plan say so. Private planning inputs, admin notes, explanations, and logs remain local/private.

- **Shared listener profiles** save favorites on the server. Choose or create a name above the catalog, then select **☆ Save** on songs in the collection, lyric sheets, or Fear & Hunger page. **Saved songs** filters the catalog and its Play/Shuffle controls; the **Saved collection** link opens the same profile on another device. Profiles and favorites are public and editable by everyone, without passwords, and are independent of votes and request/admin sign-ins. Names ignore case and repeated spaces; creating an existing name opens that profile. Only the selected profile ID is remembered in localStorage. Reloads and navigation restore it, other tabs follow profile selection changes, and server favorites refresh every 30 seconds and on returning to a tab. If storage is unavailable, the profile link still works. Failed saves are reported; an API outage preserves already loaded favorites for listening and disables further changes until a successful sync. Deploy Chairlift's matching `/profiles` endpoints before this frontend.
- One anonymous vote per rolling hour across the collection, enforced by both browser and hashed network IP. Shared networks share the allowance. This is a practical anonymous limit, not an account-based identity guarantee.
- Voting rules stay above the list during cooldowns and outages. Hover or focus a grayed-out vote to see its cooldown, pending submission, or offline explanation.
- The gate hints **“Never share your password with anyone”**. Basis songs are optional: select zero to five titles from every audio recording in `gatsby-opus/static`, sorted A–Z. The selected Tony voice is always included. Direction and “What matters most?” are optional refinements; blanks become “Use the prompt as written” and “Surprise me.” Users complete two conversation turns, then explicitly confirm the full brief. No LLM service is needed for these structured turns.
- Song requests have no hourly limit. The shared queue accepts up to ten unfinished confirmed requests, including work already in production. A full queue preserves the review for retry as soon as a slot opens; published, failed, and canceled jobs free capacity. Drafts expire after 24 hours; confirmed requests persist. Stable request IDs prevent duplicate jobs from retries.
- Requests optionally include **Authored by**, a name or nickname up to 100 characters. The browser remembers it in localStorage for future requests; clearing it removes that preference. It can be edited before confirmation and stays attached to the confirmed request through the catalog, pending rows, public queue, Backstage, and song detail pages. Existing requests without an author show no attribution. Deploy the matching Chairlift API and update the installed PC worker so new fallback-catalog entries retain the name too.
- Successful logins save each role's password and session in this browser's local storage, so reopening a tab or browser keeps access. Backstage and Make a request show whether the password was saved or browser storage prevented it. Older tab-only sessions offer **Remember login** to save the password once. Expired sessions renew automatically once; rejected saved passwords are cleared, while outages and rejection of a newly issued session preserve the accepted password for retry. Pending renewals cannot overwrite or clear a newer login from another tab. Sign out (or Lock guide for Distonyc/Deetz) removes that role's saved login. These credentials are readable by scripts on this origin; use a trusted browser profile. The current request reference stays in session storage for its tab; admins can still see every submitted request.
- Backstage defaults to **Newest first** by submission time, including **All requests**. Its Sort selector also offers **Oldest first** and **Queue priority**; the URL retains the selected sort and status across reloads. Sorting applies before pagination, and changing either control returns to page one. Production still uses higher priority first, then the oldest request. Queued priorities can be changed. Stale edits are rejected. Publishing requires a public HTTPS URL.
- [The public queue](https://yehry3.app/queue/) shows active production, Needs Attention requests with retained work, waiting requests in priority order (50 per page), and the ten latest completed songs. Every confirmed item links to a stable public details URL and its original prompt before and after publication; only the creative brief and basis-song titles are exposed. It refreshes every 30 seconds and on returning to the tab. Drafts, admin notes, worker errors, credentials, basis IDs, and local paths remain private.
- The landing catalog keeps every **Needs attention** request visible, then fills out at least three compact, collapsed **On the way** rows with active work before waiting requests. Pending work and published songs refresh every 30 seconds and on returning to the tab, preserving playback, open rows, and the reading position. Song filters apply to the playable catalog; pending rows follow the shared queue.
- The catalog defaults to **Fresh, then most loved**: releases from the last 24 hours appear first, newest first, followed by the remaining songs ranked by votes. Every current song has a retained `publishedAt` derived from its matched local delivery MP3 creation time; future worker publications save the exact publication time. Latest additions, Most loved, and A to Z remain available as separate sort choices, and nondefault sorts stay in shareable URLs.
- Browser completion alerts cover everyone's newly published songs, including releases with quality notices. Enable them on the queue page; the browser's saved permission then applies across all yehry3 pages, and an explicit **Turn off** choice is remembered locally. Permission is requested only after a click; blocked permission and incomplete alert setup are shown separately. Keep any yehry3 tab open; suspended tabs can delay alerts. The first check establishes a baseline. Shared release history survives reloads and page changes, multiple tabs coordinate delivery, and failed alerts retry. No account or email address is needed. See [notification options](NOTIFICATIONS.md) for closed-tab push, Discord, and email.
- An empty admin filter falls back to **In the studio** when a request is processing, otherwise **All requests**. Empty pages first return to the beginning of their current nonempty set.
- Backstage separates **Recovering automatically** from **Needs Attention**. Supported retries and cooldowns keep their diagnostics available. The recovery label expires after 20 minutes if monitoring stops. Public queue and request details show the same distinction. Backstage refreshes every 30 seconds while no brief or form is being edited.
- Playable songs can carry **Has issues** notices for long instrumental sections or a vocal passage that could not be fully restored. The warning stays with the song on the listening pages and public queue. A settings cog beside the catalog controls can hide these notices across the site and remembers the choice in this browser.
- The same preferences include **Continuous record spins**, which keeps the hero record turning without friction, and **Spin while music plays**, which follows playback and stops on pause unless continuous spinning is enabled. Both default off, apply immediately, and persist across reloads, navigation, and tabs. Clicking still speeds up the record. These explicit choices also work with reduced motion enabled; the default idle spins remain disabled there. New preferences give the cog a brief gentle pulse and a **New** badge until opened, remembered in this browser; reduced motion uses the badge alone.
- Fifty curated prompt suggestions are shuffled locally on page load; five cycle every 12 seconds on the collection banner and empty, unfocused request field. Typed prompts are never changed. Reduced-motion preferences disable cycling.
- Newly generated songs include a **Lyrics** link in the main list, opening a readable `/lyrics/title-hash/` route with in-browser playback, line highlighting, automatic scrolling, click-to-seek, download, and print controls. Each built route includes the song title and first lyric line in Open Graph metadata for Discord and other link previews; legacy `?song=id` links keep working. Selecting a timed lyric updates the URL; opening that link restores the same line and playback position without autoplaying. Saved lyrics and bounded line cues travel with the song metadata in Mongo and the fallback catalog. All existing songs were backfilled from their retained production word timestamps; new songs derive cues locally without another model call or render.
- Generated songs remain in **Distonyc requests** and also appear in **Fear & Hunger** when that is clearly their subject. The existing planning call makes this classification; it does not infer the collection merely from a dark style. `/?collection=fearhunger` links directly to that collection.
- The dedicated `/fearhunger/` page also reads these collection tags, keeping the original three recordings and adding matching requests automatically. It refreshes every minute and when returning to the tab, preserves current playback, and uses the static catalog during API outages.
- All catalog entries have been backfilled from saved render lyrics or source transcriptions, matched against the published MP3 hashes. Every current song has a lyrics link. See [lyrics provenance](LYRICS.md).
- `/wiseau/` lists short lines spoken by a cloned Tommy Wiseau voice, and `/wiseau/<id>` is one line's stable share page with a waveform player, copy-link and MP3 download, labelled as AI-generated. Everything is static: `wiseau/clips.json` is the manifest and `wiseau/clips/<id>.mp3` the audio, both committed to `talandar` in one commit by `scripts/share_yehry3.py` in the wiseau-tts project (via `gh` and the Git Data API, fast-forward only), which then waits for Azure to serve the new id. The build writes a copy of the page per clip at `dist/wiseau/<id>/index.html` whose title and OpenGraph tags quote the line, so a link preview (Discord and the like) shows what Tommy says; no `/wiseau/*` rewrite may exist, since Azure would apply it over those pages. `npm test` fails if the manifest, the clip files and the built pages disagree.
- Running jobs use “Cancellation requested” until the PC acknowledges it. The native Windows worker plans once, resumes the existing Troofs renderer, verifies the mix, and publishes to this site. See [Windows worker operations](pc-worker/README.md).

## Validate

Prompt and lyric pages load one public song from `/songs/:id` and an independently
requested static `/songs/<id>.json`. Up to twelve recently viewed public song
details are cached in the browser and displayed immediately; the API refreshes
them in the background. Storage failures do not block the static fallback. Prompt
refreshes preserve open disclosures and reading position, and lyric refreshes
preserve the playing audio element. Unfinished requests still refresh their plans.
Details use their own small JavaScript entry point, without the collection/admin
form modules. Existing lyric aliases, song URLs, and the full fallback catalog remain.

The collection and Fear & Hunger pages use `/songs/summary` and generated
`catalog-summary.json`, with boolean availability flags instead of full lyrics,
plans, and prompts. Voting remains live and personalized. Hidden collection tabs
skip catalog polls and refresh on return; enabled completion alerts retain their
existing background behavior. Deploy the compatible Chairlift endpoints first.

`npm run measure:live` prints a small read-only set of response times, decoded
payload sizes, and the API's `Server-Timing` measurements. Mongo time is the sum
of observed command durations, which can overlap; it excludes connection-pool
waiting and is not a database billing or bandwidth measurement. See Chairlift's
performance documentation for protected counters and slow-request logs.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests start sibling chairlift's API with disposable Mongo and the static site. Install chairlift dependencies first. They cover passwords, prompt turns/review/edit/submission, admin priority/notes/cancel/retry and empty-filter fallback, voting cooldown after reload, MP3 playback, public queue/alert opt-in and deduplication, escaped input, API outages and mobile overflow. The notification test uses a real service worker but simulates OS permission/display, which headless Chromium does not reliably support. Screenshots go to ignored `artifacts/`. Chairlift's own `npm test` covers concurrency and authorization.

The checks workflow builds/tests the standalone site and produces a `yehry3-site` artifact. The separate Azure workflow deploys `talandar` pushes and manual runs after a successful build and checks, following gatsby-opus’s Azure build/deploy pattern and this site’s existing deployment-token authentication. It uploads only `dist/`. `staticwebapp.config.json` supplies Azure Static Web Apps routes and headers. On other hosts mirror those headers and serve directory `index.html` files. Use `Cache-Control: no-cache` for the catalog and unversioned application assets.

## Launch

1. Configure the three backend secrets and allowed origins. Verify trusted proxy handling: on Fly set `YEHRY3_TRUST_FLY_PROXY=true`; elsewhere configure the actual trusted ingress first.
2. Deploy the chairlift routes, preserving its existing Mongo connection. Import `catalog.json` with its safe upsert script.
3. Deploy **`dist/`** to the static host for `yehry3.app`, connect domain/TLS, and verify the API host in `assets/config.js`.
4. Verify live MP3 ranges, voting cooldown, prompt confirmation and admin access. Label launch-test requests and cancel them afterward.

The existing Azure Static Web App is `red-cliff-02dfcb210.6.azurestaticapps.net`, serving `yehry3.app` and `www.yehry3.app`. Connect its deployment configuration to `legauntt/yehry3`, branch `talandar`, and store its deployment token as the repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. The workflow uses this site’s existing `DeploymentToken` authorization policy. Keep the resource-specific workflow filename so the Azure site remains identifiable. Production API secrets remain outside the static site. Run `npm run verify:live` after deployment to compare public assets and verify headers, MP3 seeking, catalog completeness, and API CORS.

The Windows scheduled task and publication loop are documented in [pc-worker/README.md](pc-worker/README.md). Mongo holds leased jobs and metadata; GitHub releases serve MP3s. New published songs appear in the Distonyc requests collection. Installed worker files and credentials never enter the static build.

The `/deetz` route redirects to `/deetz/`. Its public HTML contains only the login screen. Guide text, stage details, and the complete example plan are maintained in the private Chairlift repository and returned by `GET /yehry3/deetz` only with a valid submitter session bound to the browser. The response is not cached. The frontend clears content on lock or session expiry, and reloads it after automatic session renewal; its JSON download is created in memory after login. No guide content or standalone example JSON belongs in this public repository or `dist/`. The shared login retains the existing password and throttling policy. Guide scripts and styles comply with the existing CSP.

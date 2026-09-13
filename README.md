# yehry3 · The listening room

A static Tony C music site with a MongoDB voting and request API in the sibling **chairlift** repository.

| Route          | Behavior                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Both the Tony AI and Fear & Hunger catalogs; search, filters, vote sorting, Play all, Shuffle, seeking, previous/next and MP3 links |
| `/distonyc/`   | Password gate, initial idea, optional basis songs/direction follow-up, final confirmation, and request status                       |
| `/admin/`      | Separate admin login; paginated requests, filters/counts, priority, private notes, cancel/retry, production status, and history     |
| `/deetz/`      | Studio process guide and saved planning example, loaded from the authenticated API after the Distonyc login                        |
| `/fearhunger/` | Preserved original three-track page, MP3s and lyrics                                                                                |

`/distonyc/` is the request page; `/longtimecomin` and `/longtimecomin/` permanently redirect there. The local preview mirrors these redirects.

The site remains noindex. Existing audio files and URLs are preserved. The Tony AI tracks stream from their existing release URLs. Static `catalog.json` keeps listening available during API outages; voting is clearly disabled while offline.

yehry3.app is the default destination for new finished Tony/Troofs MP3s, including standalone songs. The old gatsby-opus `/tonyai` page is deprecated for new publications; keep its existing tracks and URLs working. `tonyai` remains the collection ID here, not a publication destination. Standalone additions use the existing GitHub release and Chairlift's safe catalog seed, with matching fallback metadata and lyrics; do not create artificial queue requests. Keep WAVs, A/B clips, stems and model assets local unless separately requested.

The three **Tony V7 Study** songs are experimental listening material. V6 remains the default voice, while V7 can be selected for new requests. Telephone Wire retains two brief vocal gaps around 2:16 and 2:18 (1.6 seconds total); The Last Light in the Station retains its complete 26.54-second instrumental outro. Their catalog issue notices remain visible. Technical verification is not a human listening judgment.

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

- One anonymous vote per rolling hour across the collection, enforced by both browser and hashed network IP. Shared networks share the allowance. This is a practical anonymous limit, not an account-based identity guarantee.
- Voting rules stay above the list during cooldowns and outages. Hover or focus a grayed-out vote to see its cooldown, pending submission, or offline explanation.
- The gate hints **“Never share your password with anyone”**. Basis songs are optional: select zero to five titles from every audio recording in `gatsby-opus/static`, sorted A–Z. The selected Tony voice is always included. Direction and “What matters most?” are optional refinements; blanks become “Use the prompt as written” and “Surprise me.” Users complete two conversation turns, then explicitly confirm the full brief. No LLM service is needed for these structured turns.
- Song requests have no hourly limit. The shared queue accepts up to ten unfinished confirmed requests, including work already in production. A full queue preserves the review for retry as soon as a slot opens; published, failed, and canceled jobs free capacity. Drafts expire after 24 hours; confirmed requests persist. Stable request IDs prevent duplicate jobs from retries.
- Requests optionally include **Authored by**, a name or nickname up to 100 characters. The browser remembers it in localStorage for future requests; clearing it removes that preference. It can be edited before confirmation and stays attached to the confirmed request through the catalog, pending rows, public queue, Backstage, and song detail pages. Existing requests without an author show no attribution. Deploy the matching Chairlift API and update the installed PC worker so new fallback-catalog entries retain the name too.
- Successful logins save each role's password and session in this browser's local storage, so reopening a tab or browser keeps access. Backstage and Make a request show whether the password was saved or browser storage prevented it. Older tab-only sessions offer **Remember login** to save the password once. Expired sessions renew automatically once; rejected saved passwords are cleared, while outages and rejection of a newly issued session preserve the accepted password for retry. Pending renewals cannot overwrite or clear a newer login from another tab. Sign out (or Lock guide for Distonyc/Deetz) removes that role's saved login. These credentials are readable by scripts on this origin; use a trusted browser profile. The current request reference stays in session storage for its tab; admins can still see every submitted request.
- Backstage defaults to **Newest first** by submission time, including **All requests**. Its Sort selector also offers **Oldest first** and **Queue priority**; the URL retains the selected sort and status across reloads. Sorting applies before pagination, and changing either control returns to page one. Production still uses higher priority first, then the oldest request. Queued priorities can be changed. Stale edits are rejected. Publishing requires a public HTTPS URL.
- [The public queue](https://yehry3.app/queue/) shows active production, waiting requests in priority order (50 per page), and the ten latest completed songs. It refreshes every 30 seconds and on returning to the tab. Drafts, admin notes, worker errors, credentials, and local paths remain private. The request form explains that confirmed ideas and progress are public.
- The landing catalog starts with up to three compact, collapsed **On the way** rows, with active work before waiting requests. Pending work and published songs refresh every 30 seconds and on returning to the tab, preserving playback, open rows, and the reading position. Song filters apply to the playable catalog; pending rows follow the shared queue.
- The catalog defaults to **Fresh, then most loved**: releases from the last 24 hours appear first, newest first, followed by the remaining songs ranked by votes. Every current song has a retained `publishedAt` derived from its matched local delivery MP3 creation time; future worker publications save the exact publication time. Latest additions, Most loved, and A to Z remain available as separate sort choices, and nondefault sorts stay in shareable URLs.
- Browser completion alerts cover everyone's newly published songs, including releases with quality notices. Enable them on the queue page; the browser's saved permission then applies across all yehry3 pages, and an explicit **Turn off** choice is remembered locally. Permission is requested only after a click; blocked permission and incomplete alert setup are shown separately. Keep any yehry3 tab open; suspended tabs can delay alerts. The first check establishes a baseline. Shared release history survives reloads and page changes, multiple tabs coordinate delivery, and failed alerts retry. No account or email address is needed. See [notification options](NOTIFICATIONS.md) for closed-tab push, Discord, and email.
- An empty admin filter falls back to **In the studio** when a request is processing, otherwise **All requests**. Empty pages first return to the beginning of their current nonempty set.
- Backstage's top row includes a **Needs Attention** count that opens failed requests directly.
- Playable songs can carry **Has issues** notices for long instrumental sections or a vocal passage that could not be fully restored. The warning stays with the song on the listening pages and public queue. A settings cog beside the catalog controls can hide these notices across the site and remembers the choice in this browser.
- Fifty curated prompt suggestions are shuffled locally on page load; five cycle every 12 seconds on the collection banner and empty, unfocused request field. Typed prompts are never changed. Reduced-motion preferences disable cycling.
- Newly generated songs include a **Lyrics** link in the main list, opening a readable `/lyrics/title-hash/` route with in-browser playback, line highlighting, automatic scrolling, click-to-seek, download, and print controls. Each built route includes the song title and first lyric line in Open Graph metadata for Discord and other link previews; legacy `?song=id` links keep working. Selecting a timed lyric updates the URL; opening that link restores the same line and playback position without autoplaying. Saved lyrics and bounded line cues travel with the song metadata in Mongo and the fallback catalog. All existing songs were backfilled from their retained production word timestamps; new songs derive cues locally without another model call or render.
- Generated songs remain in **Distonyc requests** and also appear in **Fear & Hunger** when that is clearly their subject. The existing planning call makes this classification; it does not infer the collection merely from a dark style. `/?collection=fearhunger` links directly to that collection.
- The dedicated `/fearhunger/` page also reads these collection tags, keeping the original three recordings and adding matching requests automatically. It refreshes every minute and when returning to the tab, preserves current playback, and uses the static catalog during API outages.
- All catalog entries have been backfilled from saved render lyrics or source transcriptions, matched against the published MP3 hashes. Every current song has a lyrics link. See [lyrics provenance](LYRICS.md).
- Running jobs use “Cancellation requested” until the PC acknowledges it. The native Windows worker plans once, resumes the existing Troofs renderer, verifies the mix, and publishes to this site. See [Windows worker operations](pc-worker/README.md).

## Validate

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

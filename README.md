# yehry3 · The listening room

A static Tony C music site with a MongoDB voting and request API in the sibling **chairlift** repository.

| Route          | Behavior                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Both the Tony AI and Fear & Hunger catalogs; search, filters, vote sorting, Play all, Shuffle, seeking, previous/next and MP3 links |
| `/distonyc/`   | Password gate, initial idea, source/direction/preservation follow-up, final confirmation, and request status                        |
| `/admin/`      | Separate admin login; paginated requests, filters/counts, priority, private notes, cancel/retry, production status, and history     |
| `/fearhunger/` | Preserved original three-track page, MP3s and lyrics                                                                                |

`/distonyc/` is the request page; `/longtimecomin` and `/longtimecomin/` permanently redirect there. The local preview mirrors these redirects.

The site remains noindex. Existing audio files and URLs are preserved. The Tony AI tracks stream from their existing release URLs. Static `catalog.json` keeps listening available during API outages; voting is clearly disabled while offline.

## Run

Node 22 or later:

```sh
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:8080`. The server serves **only `dist/`**, supports MP3 seeking, and redirects directory routes. The build copies only public pages/assets; environment files, tools, tests, and backend source cannot enter the deployment.

The browser uses `http://127.0.0.1:3000/yehry3` locally and `https://chairlift.fly.dev/yehry3` in production. Change `assets/config.js` and the CSP together if the API host changes.

For a disposable end-to-end preview, install dependencies in sibling `../chairlift`, set `YEHRY3_ADMIN_PASSWORD` to a local test password, and run `node scripts/dev-api.mjs` in a second terminal. It seeds a temporary Mongo replica set and never connects to the existing database. Its first run downloads MongoDB. The request password is `wishbone`; choose a different admin password. Preview data disappears when it stops. `CHAIRLIFT_PATH` overrides the sibling location.

For the real API, follow [chairlift's setup and queue contract](../chairlift/yehry3/README.md). Configure the submission password, separate admin password and signing secret in the backend, then run its catalog seed. No credentials are placed in the public build.

## Behavior

- One anonymous vote per rolling hour across the collection, enforced by both browser and hashed network IP. Shared networks share the allowance. This is a practical anonymous limit, not an account-based identity guarantee.
- The gate hints **“Never share your password with anyone”**. Users complete two conversation turns (idea and direction), then explicitly confirm the full brief. No LLM service is needed for these structured turns.
- Three confirmed requests per hour per browser/network. Drafts expire after 24 hours; confirmed requests persist. Stable request IDs prevent duplicate jobs from retries.
- Sessions and the current request reference use session storage for the browser tab; passwords are never retained. Closing the tab/clearing storage removes its shortcut. Admins can still see every submitted request.
- Higher priority goes first, then oldest submission. Queued priorities can be changed. Stale edits are rejected. Publishing requires a public HTTPS URL.
- Running jobs use “Cancellation requested” until acknowledged. The PC consumer and automatic upload loop are the **next phase**, not active features in this release.

## Validate

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests start sibling chairlift's API with disposable Mongo and the static site. Install chairlift dependencies first. They cover passwords, prompt turns/review/edit/submission, admin priority/notes/cancel/retry, voting cooldown after reload, MP3 playback, escaped input, API outages and mobile overflow. Screenshots go to ignored `artifacts/`. Chairlift's own `npm test` covers concurrency and authorization.

The checks workflow builds/tests the standalone site and produces a `yehry3-site` artifact. The separate Azure workflow deploys `talandar` pushes and manual runs after a successful build and checks, following gatsby-opus’s Azure build/deploy pattern and this site’s existing deployment-token authentication. It uploads only `dist/`. `staticwebapp.config.json` supplies Azure Static Web Apps routes and headers. On other hosts mirror those headers and serve directory `index.html` files. Use `Cache-Control: no-cache` for the catalog and unversioned application assets.

## Launch

1. Configure the three backend secrets and allowed origins. Verify trusted proxy handling: on Fly set `YEHRY3_TRUST_FLY_PROXY=true`; elsewhere configure the actual trusted ingress first.
2. Deploy the chairlift routes, preserving its existing Mongo connection. Import `catalog.json` with its safe upsert script.
3. Deploy **`dist/`** to the static host for `yehry3.app`, connect domain/TLS, and verify the API host in `assets/config.js`.
4. Verify live MP3 ranges, voting cooldown, prompt confirmation and admin access. Label launch-test requests and cancel them afterward.

The existing Azure Static Web App is `red-cliff-02dfcb210.6.azurestaticapps.net`, serving `yehry3.app` and `www.yehry3.app`. Connect its deployment configuration to `legauntt/yehry3`, branch `talandar`, and store its deployment token as the repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. The workflow uses this site’s existing `DeploymentToken` authorization policy. Keep the resource-specific workflow filename so the Azure site remains identifiable. Production API secrets remain outside the static site. Run `npm run verify:live` after deployment to compare public assets and verify headers, MP3 seeking, catalog completeness, and API CORS.

Future PC work starts from chairlift's documented `yehry3_prompts` contract. Mongo holds jobs and metadata; release hosting serves audio. The consumer must safely claim work, resume Troofs recipes, validate the mix, upload the MP3, add it to the catalog, and only then mark the request published.

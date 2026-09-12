# yehry3

Three Tony C arrangements of an original song about the lore of **Fear & Hunger**.

The standalone listening page is in [`fearhunger/index.html`](fearhunger/index.html), served at `/fearhunger/`. It has individual players, MP3 downloads, Play all, Shuffle, and the original lyric sheet. The songs cover the first game, including Ending A.

No build or dependencies are required. From this repository, run:

```sh
python serve.py
```

Then visit `http://localhost:8080/fearhunger/`. The local server supports MP3 seeking. A static host can serve the repository as-is. Relative links also work beneath a project URL prefix.

| Version | Length | MP3 |
| --- | --- | --- |
| Dungeon Rock | 4:30 | [Download](fearhunger/audio/fear-and-hunger-dungeon-rock.mp3) |
| Doom Blues | 4:35 | [Download](fearhunger/audio/fear-and-hunger-doom-blues.mp3) |
| Occult Swing | 4:26 | [Download](fearhunger/audio/fear-and-hunger-occult-swing.mp3) |

Only finished MP3s are included. They match the delivered recordings byte for byte; durations, sizes and SHA-256 hashes are recorded in [`catalog.json`](fearhunger/catalog.json). WAVs and production files remain local.

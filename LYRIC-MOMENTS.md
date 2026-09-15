# Share a playback moment

Lyric players include “Share this moment”, which copies the current position at
tenth-second precision using `?t=<seconds>`. Where available, the current lyric
line remains in the fragment. Existing line links keep working unchanged.

A shared timestamp takes precedence over the line's starting cue and restores
once per audio element, without autoplay. Selecting another line clears the
timestamp, so its new link seeks to that line on reload. Delayed catalog updates
preserve the audio element, playing position and paused/playing state. Tracks
without timing cues can share arbitrary playback moments too.

Invalid timestamps are ignored and values past the recording's duration are
clamped within it. If clipboard access is unavailable, the link is selected for
manual copying. No lyric timing metadata or audio files change.

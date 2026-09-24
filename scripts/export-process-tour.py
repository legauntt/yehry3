"""Export two explicitly selected, published runs as a small public listening tour.

No model calls. Private jobs never enter the build: only allowlisted catalog fields,
elapsed intervals and five equal, unnormalized MP3 excerpts per run are exported.
Windows log creation timestamps mark stage starts; publishedAt ends the last interval.
"""
import argparse
import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIPS = {"generated": "generated.wav", "guide": "selected-vocals.wav",
         "backing": "selected-backing.wav", "tony": "matched-vocals.wav"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def export_run(job, key, catalog, args):
    result = read(job / "render-result.json")
    final = next(f for f in result["files"] if f["path"].endswith(".mp3"))
    with Path(final["path"]).open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != final["sha256"]:
        raise ValueError("Published recording has changed")
    song = next(s for s in catalog["songs"] if digest[:12] in s["url"])
    if result.get("validationFailures"):
        raise ValueError("Choose a run with complete Tony conversion")
    backend = result.get("music_backend", "local")
    if backend != {"emp": "eleven_music", "ace": "local"}[key]:
        raise ValueError("Run does not match the requested generator")
    work = Path(result["work_path"])
    logs = work / "desktop-logs"
    # Creation times, unlike last-write times, include silent stages and subprocess startup.
    # These snapshots are estimates of wall time, not CPU/GPU utilization measurements.
    born = lambda p: p.stat().st_birthtime if hasattr(p.stat(), "st_birthtime") else p.stat().st_ctime
    points = [born(job / "planning-input.json"), born(job / "plan.json"),
              born(logs / "generate.log"), born(logs / "separate.log"),
              born(logs / "prepare.log"), born(logs / "validate.log"),
              born(logs / "finish.log"), datetime.fromisoformat(song["publishedAt"].replace("Z", "+00:00")).timestamp()]
    offsets = [round(t - points[0]) for t in points]
    seconds = [b - a for a, b in zip(offsets, offsets[1:])]
    if any(s < 0 for s in seconds):
        raise ValueError("Non-monotonic stage timestamps; select a single uninterrupted run")
    output = ROOT / "sausage/audio"
    output.mkdir(parents=True, exist_ok=True)
    clips = {}
    sources = {**{k: work / v for k, v in CLIPS.items()},
               "final": Path(next(f["path"] for f in result["files"] if f["path"].endswith(".wav")))}
    for name, source in sources.items():
        target = output / f"{key}-{name}.mp3"
        subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(args.start),
                        "-i", str(source), "-t", str(args.length), "-map_metadata", "-1",
                        "-vn", "-c:a", "libmp3lame", "-b:a", "128k", str(target)], check=True)
        clips[name] = f"/sausage/audio/{target.name}"
    public = {k: song[k] for k in ["id", "title", "url", "duration", "voiceModel", "publishedAt",
                                   "musicBackend", "pitchRepair", "qualityIssues", "reviewState", "validationFailures"] if k in song}
    public["musicBackend"] = backend
    retry = read(work / "pitch-resing.json") if (work / "pitch-resing.json").exists() else {}
    return {"key": key, "song": public, "seconds": seconds, "totalSeconds": offsets[-1],
            "clipStart": args.start, "clipSeconds": args.length, "clips": clips,
            "vocalRetries": len(retry.get("phrases", []))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emp-job", type=Path, required=True)
    parser.add_argument("--ace-job", type=Path, required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--start", type=int, default=30)
    parser.add_argument("--length", type=int, default=24)
    args = parser.parse_args()
    catalog = read(ROOT / "catalog.json")
    data = {"version": 1, "timingBasis": "Saved stage-log creation times, rounded to seconds; publication ends the final interval.",
            "runs": [export_run(args.emp_job, "emp", catalog, args), export_run(args.ace_job, "ace", catalog, args)]}
    (ROOT / "sausage/tour.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({r["key"]: {"title": r["song"]["title"], "seconds": r["seconds"], "total": r["totalSeconds"]} for r in data["runs"]}))


if __name__ == "__main__":
    main()

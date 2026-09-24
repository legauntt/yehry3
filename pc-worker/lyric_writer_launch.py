"""Windowless entry point for the independent lyric writer."""
from pathlib import Path
from launch_hidden import run

if __name__ == '__main__':
    raise SystemExit(run('lyrics', Path(__file__).parent))

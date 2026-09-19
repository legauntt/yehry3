import json, tempfile, unittest
from pathlib import Path
from basis_release import materialize, verify_remote_catalog
from common import sha


class BasisReleaseTests(unittest.TestCase):
    def setup_catalog(self, root):
        basis_root = root / 'site' / 'static'; basis_root.mkdir(parents=True)
        studio = root / 'audio' / 'troofs-studio'; studio.mkdir(parents=True)
        catalog = root / 'audio' / 'catalog-expansion-v6'; catalog.mkdir()
        payload = b'release-backed-audio'; digest = __import__('hashlib').sha256(payload).hexdigest()
        manifest = root / 'manifest.json'
        manifest.write_text(json.dumps({'version': 1, 'assets': [{'legacyPath': '/dvdp/song.m4a',
            'url': 'https://github.com/legauntt/gatsby-opus/releases/download/site-audio-v1/song.m4a',
            'bytes': len(payload), 'sha256': digest}]}))
        missing = basis_root / 'dvdp' / 'song.m4a'
        (catalog / 'sources.json').write_text(json.dumps([{'source': str(missing), 'relative_path': 'dvdp\\song.m4a',
            'bytes': len(payload), 'sha256': digest}]))
        config = {'basis_root': str(basis_root), 'basis_release_manifest': str(manifest),
            'basis_cache': str(root / 'cache'), 'state_dir': str(root / 'state'), 'settings': {'studio_dir': str(studio)}}
        return config, missing, payload, digest

    def test_missing_local_originals_are_verified_against_release_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            config, missing, _, _ = self.setup_catalog(Path(directory))
            result = verify_remote_catalog(config, ValueError('Project dependencies need attention:\nMissing original: ' + str(missing)))
            self.assertEqual(result['release_backed_originals'], 1)

    def test_verified_private_cache_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            config, _, payload, digest = self.setup_catalog(Path(directory))
            cached = Path(config['basis_cache']) / 'dvdp' / 'song.m4a'; cached.parent.mkdir(parents=True); cached.write_bytes(payload)
            path = materialize(config, {'relativePath': 'dvdp/song.m4a'})
            self.assertEqual(path, cached.resolve())
            self.assertEqual(sha(path), digest)


if __name__ == '__main__': unittest.main()

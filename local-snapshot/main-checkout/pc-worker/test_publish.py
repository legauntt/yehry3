import base64
import hashlib
import json
import unittest
from unittest.mock import patch

from publish import catalog_content, song_record, update_catalog


def large_catalog(songs):
    content = json.dumps({'songs': songs, 'retained': 'x' * (1024 * 1024)}).encode()
    digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    metadata = {'sha': digest, 'size': len(content), 'encoding': 'none', 'content': ''}
    blob = {**metadata, 'encoding': 'base64', 'content': base64.b64encode(content).decode()}
    return metadata, blob


class LargeCatalogTests(unittest.TestCase):
    def test_large_catalog_merge_reloads_after_concurrent_commit(self):
        original = {'id': 'old', 'title': 'Retained song'}
        concurrent = {'id': 'concurrent', 'title': 'Concurrent publication'}
        first, blob1 = large_catalog([original])
        second, blob2 = large_catalog([concurrent, original])
        writes = []
        reads = []
        prompt = {'songId': 'distonyc-one', 'result': {'title': 'Finished song', 'duration': 255},
                  'releaseUrl': 'https://example.com/song.mp3', 'details': {'voiceModel': 'v7'},
                  'songPlan': {'title': 'Finished song'}}
        def github(config, args, body=None):
            if body is not None:
                writes.append(body)
                if len(writes) == 1:
                    raise RuntimeError('HTTP 409 conflict')
                return {}
            if '/git/blobs/' in args[-1]:
                reads.append(args[-1])
                return {first['sha']: blob1, second['sha']: blob2}[args[-1].rsplit('/', 1)[-1]]
            return second if writes else first
        with patch('publish.gh_json', side_effect=github):
            update_catalog({}, prompt)
        merged = json.loads(base64.b64decode(writes[-1]['content']))
        self.assertEqual([song['id'] for song in merged['songs']], ['distonyc-one', 'concurrent', 'old'])
        self.assertEqual(merged['retained'], 'x' * (1024 * 1024))
        self.assertEqual(writes[-1]['sha'], second['sha'])
        self.assertEqual(merged['songs'][0], song_record(prompt))
        self.assertEqual(merged['songs'][0]['voiceModel'], 'v7')
        self.assertEqual(merged['songs'][0]['songPlan'], prompt['songPlan'])
        self.assertEqual([path.rsplit('/', 1)[-1] for path in reads], [first['sha'], second['sha']])

    def test_different_blob_bytes_or_size_cannot_be_merged(self):
        metadata, blob = large_catalog([])
        for changed in ({**blob, 'sha': '0' * 40}, {**blob, 'content': base64.b64encode(b'{}').decode()},
                        {**blob, 'size': 1}):
            with self.subTest(keys=changed.keys()), patch('publish.gh_json', return_value=changed):
                with self.assertRaisesRegex(ValueError, 'catalog blob|verification'):
                    catalog_content({}, metadata)

    def test_inline_catalog_needs_no_extra_request(self):
        payload = {'songs': [{'id': 'retained'}]}
        metadata = {'encoding': 'base64', 'content': base64.b64encode(json.dumps(payload).encode()).decode()}
        with patch('publish.gh_json') as github:
            self.assertEqual(catalog_content({}, metadata), payload)
            github.assert_not_called()


if __name__ == '__main__':
    unittest.main()

import base64
import hashlib
import json
import unittest
from unittest.mock import patch

from publish import asset_url, catalog_content, merge_catalog, song_record, update_catalog


def large_catalog(songs):
    content = json.dumps({'songs': songs, 'retained': 'x' * (1024 * 1024)}).encode()
    digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    metadata = {'sha': digest, 'size': len(content), 'encoding': 'none', 'content': ''}
    blob = {**metadata, 'encoding': 'base64', 'content': base64.b64encode(content).decode()}
    return metadata, blob


class LargeCatalogTests(unittest.TestCase):
    def test_retained_completion_replaces_only_matching_recording_once(self):
        old = {'id': 'distonyc-one', 'title': 'Wordless song', 'url': asset_url('distonyc-one', 'a' * 64),
               'voiceModel': 'v9', 'duration': 540, 'validationFailures': ['unconverted_vocals'],
               'reviewState': 'needs_review', 'listenerData': 'keep'}
        catalog = {'songs': [dict(old), {'id': 'other', 'title': 'Untouched'}]}
        record = {'id': old['id'], 'title': old['title'], 'voiceModel': 'v9', 'duration': 540,
                  'url': asset_url(old['id'], 'b' * 64), 'repairedAt': '2026-09-26T10:00:00Z'}
        completion = {'priorUrl': old['url'], 'priorSha256': 'a' * 64,
                      'priorResult': {'validationFailures': ['unconverted_vocals']}, 'requestResult': {'sha256': 'b' * 64}}
        self.assertTrue(merge_catalog(catalog, record, completion))
        self.assertEqual(catalog['songs'][0], {**record, 'listenerData': 'keep'})
        self.assertFalse(merge_catalog(catalog, record, completion))
        self.assertEqual(catalog['songs'][1], {'id': 'other', 'title': 'Untouched'})
        for changes in ({'url': asset_url(old['id'], 'c' * 64)}, {'title': 'Edited'}, {'reviewDecision': 'accepted'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                merge_catalog({'songs': [{**old, **changes}]}, record, completion)

    def test_repair_completion_time_reaches_the_fallback_catalog(self):
        repaired = '2026-09-25T19:42:00.000Z'
        prompt = {'songId': 'repaired-song', 'releaseUrl': 'https://example.com/repaired.mp3',
                  'result': {'title': 'Repaired', 'duration': 200, 'repairedAt': repaired}}
        self.assertEqual(song_record(prompt)['repairedAt'], repaired)

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

    def test_catalog_preserves_v8_voice_and_generation_identity(self):
        from generation_controls import normalize
        prompt = {'songId': 'v8-test', 'prompt': 'A new song about the rain', 'details': {'voiceModel': 'v8', 'generation': normalize({'version': 1})},
                  'result': {'title': 'V8 test', 'duration': 120, 'voiceModel': 'v8', 'generationProfile': 'v8'},
                  'releaseUrl': 'https://example.com/v8.mp3'}
        song = song_record(prompt)
        self.assertEqual(song['voiceModel'], 'v8')
        self.assertEqual(song['generationProfile'], 'v8')
        self.assertEqual(song['originalPrompt']['generationProfile'], 'v8')
        self.assertEqual(song['originalPrompt']['voiceModel'], 'v8')
        self.assertEqual(song['originalPrompt']['generation'], prompt['details']['generation'])
        for voice in ['v6', 'v7']:
            legacy = {**prompt, 'details': {'voiceModel': voice}, 'result': {'title': 'Legacy', 'duration': 120}}
            self.assertNotIn('generationProfile', song_record(legacy))
            self.assertNotIn('generationProfile', song_record(legacy)['originalPrompt'])

    def test_inline_catalog_needs_no_extra_request(self):
        payload = {'songs': [{'id': 'retained'}]}
        metadata = {'encoding': 'base64', 'content': base64.b64encode(json.dumps(payload).encode()).decode()}
        with patch('publish.gh_json') as github:
            self.assertEqual(catalog_content({}, metadata), payload)
            github.assert_not_called()


if __name__ == '__main__':
    unittest.main()

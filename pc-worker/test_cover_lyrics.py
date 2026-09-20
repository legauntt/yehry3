import tempfile, unittest
from pathlib import Path

from common import fingerprint, load, save
from cover_lyrics import LookupUnavailable, apply, choose, queries, requested

WORDS = '\n'.join(f'Invented line {n} about a lantern on the harbor wall' for n in range(1, 13))


def row(title='Harbor Lantern', artist='The Tide Pools', words=WORDS, **extra):
    return {'id': 7, 'trackName': title, 'artistName': artist, 'plainLyrics': words, 'instrumental': False, **extra}


def brief(prompt='Tony C and the Truth cover The Tide Pools\' "Harbor Lantern"', **details):
    return {'prompt': prompt, 'details': {'direction': 'Use the prompt as written.', 'lyricSheet': None, 'basisSongIds': [], **details}}


class CoverLyricsTests(unittest.TestCase):
    def test_only_an_unsupplied_cover_request_is_looked_up(self):
        self.assertIsNotNone(requested(brief()))
        self.assertIsNone(requested(brief('A new song about a harbor lantern')))
        self.assertIsNone(requested(brief(lyricSheet={'mode': 'preserve', 'text': 'My own words'})))
        self.assertIsNone(requested(brief(basisSongIds=['dvdp-road'])))
        self.assertIsNone(requested(brief(remixSource={'songId': 'distonyc-1'})))

    def test_queries_name_the_artist_and_title_in_common_phrasings(self):
        self.assertEqual(queries(requested(brief()))[0], {'track_name': 'Harbor Lantern', 'artist_name': 'The Tide Pools'})
        self.assertEqual(queries('Please cover "Harbor Lantern" by The Tide Pools, but slower')[0],
                         {'track_name': 'Harbor Lantern', 'artist_name': 'The Tide Pools'})
        self.assertEqual(queries('A cover of Harbor Lantern by The Tide Pools')[0],
                         {'track_name': 'Harbor Lantern', 'artist_name': 'The Tide Pools'})
        self.assertEqual(queries('Tony C covers Captain Foghorn covering The Tide Pools\' "Harbor Lantern"')[0],
                         {'track_name': 'Harbor Lantern', 'artist_name': 'The Tide Pools'})
        self.assertEqual(queries('whatever', {'artist': 'The Tide Pools', 'title': 'Harbor Lantern'})[0],
                         {'track_name': 'Harbor Lantern', 'artist_name': 'The Tide Pools'})

    def test_choice_requires_the_named_song_and_prefers_the_named_artist(self):
        text = requested(brief())
        self.assertIsNone(choose([row('Some Other Song')], text))
        self.assertIsNone(choose([row(instrumental=True)], text))
        self.assertIsNone(choose([row(words='too short')], text))
        tribute = [row(artist='Karaoke Crew', words=WORDS + '\nExtra tribute line'), row(artist='Karaoke Crew', words=WORDS + '\nExtra tribute line')]
        self.assertEqual(choose(tribute + [row()], text)['artistName'], 'The Tide Pools')

    def test_found_words_are_frozen_and_every_retry_rebuilds_the_same_brief(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            def get(query): calls.append(query); return [row()]
            first = apply(root, brief(), get=get)
            sheet = first['details']['lyricSheet']
            self.assertEqual((sheet['mode'], sheet['origin'], sheet['title']), ('preserve', 'cover_lookup', 'Harbor Lantern'))
            self.assertEqual(sheet['text'], WORDS)
            # Planning has begun: later passes never call the service again.
            save(Path(root) / 'plan.json', {})
            again = apply(root, brief(), get=lambda query: self.fail('Unexpected second lookup'))
            self.assertEqual(fingerprint(again), fingerprint(first)); self.assertEqual(len(calls), 1)
            record = load(Path(root) / 'cover-lyrics.json'); record['text'] += '\nTampered'
            save(Path(root) / 'cover-lyrics.json', record)
            with self.assertRaisesRegex(ValueError, 'changed'): apply(root, brief())

    def test_a_short_confirmed_length_adapts_instead_of_rushing(self):
        with tempfile.TemporaryDirectory() as root:
            long_words = '\n'.join(f'Invented line {n} with several more words to sing' for n in range(1, 60))
            result = apply(root, brief(generation={'duration': 90}), get=lambda query: [row(words=long_words)])
            self.assertEqual(result['details']['lyricSheet']['mode'], 'adapt')

    def test_missing_song_is_recorded_and_planned_jobs_are_left_alone(self):
        with tempfile.TemporaryDirectory() as root:
            request = brief()
            self.assertEqual(apply(root, request, get=lambda query: []), request)
            self.assertEqual(load(Path(root) / 'cover-lyrics.json')['status'], 'not_found')
        with tempfile.TemporaryDirectory() as root:
            save(Path(root) / 'planning-input.json', {})
            self.assertEqual(apply(root, brief(), get=lambda query: self.fail('Planned jobs keep their brief')), brief())
            self.assertFalse((Path(root) / 'cover-lyrics.json').exists())

    def test_service_outage_is_a_retryable_failure_with_nothing_frozen(self):
        with tempfile.TemporaryDirectory() as root:
            def down(query): raise LookupUnavailable('Cover lyric lookup connection failed (temporary): timed out')
            with self.assertRaisesRegex(RuntimeError, 'temporary'): apply(root, brief(), get=down)
            self.assertFalse((Path(root) / 'cover-lyrics.json').exists())
            from queue_monitor import classify
            self.assertEqual(classify('cover lyric lookup connection failed (temporary): timed out', {})[:2], ('transient_runtime', 'retry'))

    def test_worker_writes_held_words_into_the_plan_and_a_retry_reuses_the_frozen_brief(self):
        import json
        from unittest.mock import patch
        from planner import make_plan
        from request_materials import words
        from test_worker import plan
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.', encoding='utf-8')
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            request = {'prompt': brief()['prompt'], 'details': brief()['details']}
            seen = []
            def planner(invocation, cwd, log, stop=None, timeout=None, input_text=''):
                seen.append(input_text)
                answer = {**plan(), 'title': 'Harbor Lantern (Tony C Cover)', 'lyrics': ''}
                Path(invocation[invocation.index('--output-last-message') + 1]).write_text(json.dumps(answer), encoding='utf-8')
            with patch('cover_lyrics.fetch', return_value=[row()]) as service, patch('planner.run_owned', side_effect=planner):
                made = make_plan(config, request, root, [])
                # The planner is told about the words but never carries or echoes them.
                self.assertIn('COVER REQUEST WITH A LYRIC SHEET', seen[0]); self.assertIn('held by the worker', seen[0])
                self.assertNotIn('Invented line 3 about a lantern', seen[0])
                self.assertEqual(words(made['lyrics']), words(WORDS)); self.assertTrue(made['lyrics'].endswith('[End]'))
                snapshot = load(root / 'planning-input.json')
                self.assertEqual(snapshot['brief']['details']['lyricSheet']['origin'], 'cover_lookup')
                self.assertEqual(snapshot['briefHash'], fingerprint(snapshot['brief']))
                # The server still sends the unedited request; the saved journal restores the planning brief.
                self.assertEqual(make_plan(config, request, root, []), made)
                self.assertEqual(service.call_count, 1); self.assertEqual(len(seen), 1)

    def test_hosted_composer_gets_a_loose_cover_and_the_mode_is_frozen(self):
        from cover_lyrics import fill, guidance, held, labeled, planning_view
        with tempfile.TemporaryDirectory() as root:
            paid = apply(root, brief(musicBackend='eleven_music', generation={'duration': 270}), get=lambda query: [row()])
            self.assertEqual(paid['details']['lyricSheet']['mode'], 'adapt'); self.assertFalse(held(paid))
            self.assertIn('loose cover', guidance(paid)); self.assertNotIn('holds the retrieved words', guidance(paid))
            self.assertEqual(planning_view(paid), paid, 'a rewrite needs the words in view')
            self.assertEqual(fill({'recipe': 'new', 'lyrics': 'Fresh wording'}, paid)['lyrics'], 'Fresh wording')
            # A later policy change cannot move this job's brief: the journal keeps its mode.
            self.assertEqual(load(Path(root) / 'cover-lyrics.json')['mode'], 'adapt')
            self.assertEqual(apply(root, brief(), get=None)['details']['lyricSheet']['mode'], 'adapt')
        chorus = 'Shine the lantern\nOver the wall'
        sectioned = labeled('\n\n'.join(['First verse line one\nFirst verse line two', chorus, 'Second verse line\nAnother line', chorus]))
        self.assertEqual([line for line in sectioned.splitlines() if line.startswith('[')], ['[Verse 1]', '[Chorus]', '[Verse 2]', '[Chorus]', '[End]'])
    def test_guided_replan_direction_reaches_the_planner_once(self):
        from unittest.mock import patch
        from planner import make_plan
        from replan import prepare
        from test_worker import plan
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.', encoding='utf-8')
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            request = {'prompt': 'Tony sings that harbor song everyone knows', 'details': brief()['details']}
            refused = {'prompt': request['prompt'], 'details': request['details']}
            save(root / 'plan.json', {'briefHash': fingerprint(refused), 'plan': {**plan(), 'recipe': 'needs_attention'}})
            save(root / 'planning-input.json', {'briefHash': fingerprint(refused), 'brief': refused, 'basis': []})
            prepare(root, 'steer-1', True, 'Treat it as a loose cover set to new music.', {'artist': 'The Tide Pools', 'title': 'Harbor Lantern'})
            cover = {**plan(), 'lyrics': '[Verse 1]\n' + WORDS + '\n[End]'}
            with patch('cover_lyrics.fetch', return_value=[row()]), patch('planner.plan_materials', return_value=cover) as model:
                make_plan(config, request, root, [])
                self.assertIn('OPERATOR RECOVERY DIRECTION', model.call_args.args[3])
                self.assertIn('loose cover set to new music', model.call_args.args[3])
                self.assertEqual(load(root / 'planning-input.json')['recoveryNote'], 'Treat it as a loose cover set to new music.')
                self.assertEqual(load(root / 'replans/1/plan.json')['plan']['recipe'], 'needs_attention')

    def test_a_cover_with_any_lyric_sheet_is_planned_as_new_music(self):
        from cover_lyrics import guidance
        submitted = brief(lyricSheet={'mode': 'preserve', 'text': WORDS})
        self.assertIn('A cover is not a source-dependent rendition', guidance(submitted))
        self.assertEqual(guidance(brief()), '', 'no words yet: nothing to promise')
        self.assertEqual(guidance(brief('A new song about a lantern', lyricSheet={'mode': 'preserve', 'text': WORDS})), '')
        self.assertEqual(guidance(brief(lyricSheet={'mode': 'preserve', 'text': WORDS}, basisSongIds=['dvdp-road'])), '')

    def test_guided_hint_names_the_song_when_the_request_does_not(self):
        with tempfile.TemporaryDirectory() as root:
            result = apply(root, brief('Tony sings that harbor song everyone knows'), {'artist': 'The Tide Pools', 'title': 'Harbor Lantern'},
                           get=lambda query: [row()])
            self.assertEqual(result['details']['lyricSheet']['title'], 'Harbor Lantern')


if __name__ == '__main__': unittest.main()

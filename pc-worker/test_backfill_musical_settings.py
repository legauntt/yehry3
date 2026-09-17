import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from common import fingerprint, load, save
from backfill_musical_settings import prepare, main
from test_public_plan import PLAN


class BackfillMusicalSettingsTests(unittest.TestCase):
    def fixture(self):
        plan = {**PLAN, 'arrangement': 'Slow soul-rock. Piano and bass. Soft verses build to a full chorus.',
                'lyrics': '[Verse]\nA line\n[Chorus]\nA refrain\n[End]'}
        settings = dict(genre='soul-rock', instruments=['Piano', 'bass'], meter='',
                        structure='Verse → Chorus', performance='Soft',
                        energy='Soft verses build to a full chorus.', lyricWorkflow='')
        song = dict(id='saved-song', title='Song', url='https://example.com/song.mp3', songPlan=plan,
                    votes=7, publishedAt='2026-09-01T12:00:00Z', duration=200, lyrics={'text':'Final words'})
        entry = dict(id=song['id'], title=song['title'], url=song['url'],
                     planHash=fingerprint(plan), musicalSettings=settings)
        return dict(songs=[song]), dict(version=1, source='existing-public-song-plans', songs=[entry])

    def test_backfill_only_adds_the_reviewed_summary_and_replays_without_mutating_inputs(self):
        catalog, manifest = self.fixture()
        before = copy.deepcopy(catalog)
        change = prepare(catalog, manifest)[0]
        self.assertTrue(change['missing'])
        self.assertEqual(catalog, before)
        enriched = copy.deepcopy(catalog)
        enriched['songs'][0]['songPlan'] = change['songPlan']
        self.assertEqual({k:v for k,v in change['songPlan'].items() if k != 'musicalSettings'}, before['songs'][0]['songPlan'])
        self.assertFalse(prepare(enriched, manifest)[0]['missing'])
        manifest['songs'][0]['musicalSettings']['performance'] = ''
        with self.assertRaisesRegex(ValueError, 'different musical summary'):
            prepare(enriched, manifest)

    def test_recording_plan_and_source_evidence_must_all_match(self):
        catalog, manifest = self.fixture()
        for change in [dict(url='https://example.com/other.mp3'), dict(title='Other'),
                       dict(planHash='0'*64), dict(id='unknown'),
                       dict(musicalSettings={**manifest['songs'][0]['musicalSettings'], 'instruments':['Violin']}),
                       dict(musicalSettings={**manifest['songs'][0]['musicalSettings'], 'structure':'Outro → Verse'}),
                       dict(musicalSettings={**manifest['songs'][0]['musicalSettings'], 'private':'data'})]:
            invalid = copy.deepcopy(manifest)
            invalid['songs'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                prepare(catalog, invalid)

    def test_invalid_last_entry_stops_the_entire_batch_before_sync_or_file_write(self):
        catalog, manifest = self.fixture()
        manifest['songs'].append({**manifest['songs'][0], 'id':'missing-song'})
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); save(root/'catalog.json',catalog); save(root/'manifest.json',manifest)
            before=(root/'catalog.json').read_bytes()
            with patch('sys.argv',['backfill','--catalog',str(root/'catalog.json'),'--manifest',str(root/'manifest.json'),'--write','--sync','--config','unused']), patch('backfill_musical_settings.API') as api:
                with self.assertRaisesRegex(ValueError,'Unknown backfill song'): main()
                api.assert_not_called()
            self.assertEqual((root/'catalog.json').read_bytes(),before)

    def test_reviewed_manifest_remains_grounded_in_the_published_plans(self):
        root=Path(__file__).resolve().parents[1]
        manifest=load(root/'pc-worker/backfills/musical-settings-20260917.json')
        changes=prepare(load(root/'catalog.json'),manifest)
        self.assertEqual(len(changes),78)
        self.assertTrue(all(change['songPlan']['musicalSettings']['instruments'] for change in changes))


if __name__ == '__main__': unittest.main()

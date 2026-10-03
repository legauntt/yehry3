import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from common import fingerprint, load, save
from operator_local_ace import exact_plan, require_unstarted, switch


class LocalSwitchTests(unittest.TestCase):
    def fixture(self):
        details = {'musicBackend': 'eleven_music', 'voiceModel': 'vdb', 'source': '',
            'basisSongIds': [], 'lyricSheet': {'mode': 'preserve',
                'text': '[Verse 1]\n' + 'These are supplied words with original punctuation.\n' * 8},
            'generation': {'version': 1, 'duration': 400}}
        brief = {'prompt': 'Country song', 'details': details}
        plan = {'recipe': 'needs_attention', 'title': 'Country Song', 'style': 'rock',
            'duration': 400, 'bpm': 92, 'keyscale': 'D major', 'lyrics': '',
            'arrangement': 'Contemporary country with acoustic guitar, pedal steel, fiddle, bass and drums, a melodic male lead and resolved close.',
            'preserve_generated_backing': True, 'explanation': 'Cannot use this lyric sheet'}
        prompt = {'id': 'song', 'prompt': brief['prompt'], 'details': copy.deepcopy(details),
            'version': 4, 'status': 'failed', 'workerActive': False,
            'workerProgress': {'stage': 'Planning the song'}}
        saved = {'briefHash': fingerprint(brief), 'plan': plan}
        return brief, saved, prompt

    def test_exact_words_and_metadata(self):
        brief, saved, prompt = self.fixture(); prompt['details']['musicBackend'] = 'local'
        _, plan = exact_plan(saved, brief, prompt)
        self.assertEqual(plan['lyrics'], brief['details']['lyricSheet']['text'].strip() + '\n[End]')
        for key in ('duration', 'bpm', 'keyscale', 'arrangement', 'title', 'style'):
            self.assertEqual(plan[key], saved['plan'][key])
        for key in ('voiceModel', 'lyricSheet', 'generation'):
            altered = copy.deepcopy(prompt); altered['details'][key] = {}
            with self.assertRaises(ValueError): exact_plan(saved, brief, altered)
        saved['briefHash'] = 'wrong'
        with self.assertRaises(ValueError): exact_plan(saved, brief, prompt)

    def test_started_audio_is_frozen(self):
        _, _, prompt = self.fixture()
        with tempfile.TemporaryDirectory() as temp:
            require_unstarted(prompt, temp)
            for key in ('songPlan', 'result', 'generationReview'):
                with self.assertRaises(ValueError): require_unstarted({**prompt, key: {}}, temp)
            for name in ('render-request.json', 'render-result.json', 'approved-plan.json'):
                path = Path(temp) / name; path.write_text('{}')
                with self.assertRaises(ValueError): require_unstarted(prompt, temp)
                path.unlink()

    def test_lost_response_reconciles_and_archive_budget_is_not_reset(self):
        brief, saved, prompt = self.fixture()
        class API:
            calls = 0
            def prompts(self): return [copy.deepcopy(prompt)]
            def call(self, path, method, body):
                self.calls += 1
                prompt['details']['musicBackend'] = 'local'; prompt['version'] += 1
                prompt['backendRevisions'] = [{'requestId': body['requestId']}]
                raise TimeoutError('Response lost after server commit')
        api = API()
        with tempfile.TemporaryDirectory() as temp:
            config = {'state_dir': temp}; directory = Path(temp) / 'jobs' / 'song'
            save(directory / 'plan.json', saved)
            save(directory / 'planning-input.json', {'brief': brief, 'briefHash': fingerprint(brief)})
            with self.assertRaises(TimeoutError): switch(config, api, 'song')
            switch(config, api, 'song'); switch(config, api, 'song')
            self.assertEqual(api.calls, 1)
            self.assertEqual(load(directory / 'replans' / '1' / 'plan.json'), saved)
            self.assertEqual(len(load(directory / 'replans' / 'journal.json')['replans']), 1)
            self.assertEqual(load(directory / 'plan.json')['plan']['recipe'], 'new')


if __name__ == '__main__': unittest.main()

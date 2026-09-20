import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save
from generation_controls import constraints, normalize, planning_guidance, recent_vocabulary
from planner import make_plan
from test_planner import fixture
import test_planner


class GenerationControlsTests(unittest.TestCase):
    def test_explicit_constraints_reject_silent_substitutions(self):
        plan = fixture()
        brief = {'details': {'generation': {'version': 1, 'bpm': 96, 'keyscale': 'D minor'}}}
        before = copy.deepcopy(plan)
        with self.assertRaisesRegex(ValueError, 'bpm selection must be 96'):
            constraints(plan, brief)
        self.assertEqual(plan, before)
        result = constraints({**plan, 'bpm': 96, 'keyscale': 'D minor'}, brief)
        self.assertEqual(result['generation']['bpm'], 96)

    def test_lyric_locks_and_required_phrases_survive_normalization(self):
        plan = fixture()
        line = 'A rose upon the stairway, a knock upon the door.'
        options = {'version': 1, 'lockedLines': [line], 'requiredPhrases': ['ROSE upon the stairway'],
                   'avoidPhrases': ['rose'], 'lyricWorkflow': 'story'}
        result = constraints(plan, {'details': {'generation': options}})
        self.assertEqual(result['lyrics'], plan['lyrics'])
        with self.assertRaisesRegex(ValueError, 'locked lyric line'):
            constraints({**plan, 'lyrics': plan['lyrics'].replace('rose', 'flower')}, {'details': {'generation': options}})
        self.assertIn('supplied lyrics and locked lines take priority', planning_guidance({'details': {'generation': options}}))

    def test_invalid_and_conflicting_options_fail(self):
        for value in [{'version': True}, {'version': 1, 'bpm': True}, {'version': 1, 'seed': -1},
                      {'version': 1, 'bpm': float('nan')}, {'version': 1, 'keyscale': 'D dorian'},
                      {'version': 1, 'instruments': ['Bass'], 'avoidInstruments': ['bass']},
                      {'version': 1, 'avoidPhrases': ['grin', 'Grin']}, {'version': 1, 'unknown': True}]:
            with self.subTest(value=value), self.assertRaises(ValueError): normalize(value)
        self.assertNotIn('bpm', normalize({'version': 1, 'bpm': None}))

    def test_vocabulary_counts_songs_and_freezes_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / 'jobs' / 'current'
            save(root / 'jobs' / 'older' / 'plan.json', {'plan': {'lyrics': 'Crooked crooked grin'}})
            save(directory / 'plan.json', {'plan': {'lyrics': 'shoes'}})
            first = recent_vocabulary({'state_dir': str(root)}, directory)
            self.assertEqual(first['song_counts'], {'crooked': 1, 'grin': 1})
            save(root / 'jobs' / 'new' / 'plan.json', {'plan': {'lyrics': 'shoes shoes'}})
            self.assertEqual(recent_vocabulary({'state_dir': str(root)}, directory), first)

    def test_planning_corrects_wrong_bpm_and_reuses_frozen_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = test_planner.PlannerTests()
            config, brief, calls, mock_model = helper.run_feedback_case(root, [fixture(), {**fixture(), 'bpm': 96}])
            brief['details']['generation'] = {'version': 1, 'bpm': 96, 'lyricWorkflow': 'hook'}
            with mock_model:
                result = make_plan(config, brief, root, [])
            self.assertEqual(len(calls), 2)
            self.assertEqual(result['bpm'], 96)
            self.assertEqual(result['generation']['lyricWorkflow'], 'hook')
            before = (root / 'plan.json').read_bytes()
            with patch('planner.run_owned') as model:
                self.assertEqual(make_plan(config, brief, root, []), result)
                model.assert_not_called()
            self.assertEqual((root / 'plan.json').read_bytes(), before)

    def test_pitch_setting_is_frozen_for_the_voice_runtime_and_hidden_from_the_planner(self):
        options = {'version': 1, 'pitchRepair': 'clean', 'pitchCompare': 'wild'}
        result = constraints(fixture(), {'details': {'generation': options}})
        self.assertEqual((result['generation']['pitchRepair'], result['generation']['pitchCompare']), ('clean', 'wild'))
        self.assertNotIn('pitchRepair', normalize({'version': 1}))
        guidance = planning_guidance({'details': {'generation': options}})
        self.assertNotIn('pitch', guidance.lower())
        for bad in ({'pitchRepair': 'possessed'}, {'pitchCompare': 'wild'}, {'pitchRepair': 'wild', 'pitchCompare': 'wild'}):
            with self.assertRaises(ValueError): normalize({'version': 1, **bad})


if __name__ == '__main__': unittest.main()
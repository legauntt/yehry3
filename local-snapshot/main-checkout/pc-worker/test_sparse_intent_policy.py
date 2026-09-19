import unittest

from sparse_intent_policy import lyric_words, validate_evidence, validate_evidence_for_kind, validate_intent


class SparseIntentPolicyTests(unittest.TestCase):
    def request(self):
        return {'prompt_id': 'job-1', 'directory': r'C:\state\jobs\job-1',
                'music_backend': 'eleven_music', 'plan': {'recipe': 'new',
                'lyrics': '[Verse]\nYeah\nYeeaah\n[End]',
                'arrangement': 'Heavy breathing is the principal vocal texture.'}}

    def evidence(self):
        return {'duration': 230., 'first_detected_voice': 13., 'last_detected_voice': 224.,
                'voiced_energy_fraction': .22, 'last_second_mix_dbfs': -60.,
                'estimated_word_count': 12}

    def test_reviewed_intent_and_measurements_are_narrow(self):
        self.assertEqual(lyric_words('[Verse]\nYeah\nYeeaah\n[End]'), ['yeah', 'yeeaah'])
        self.assertTrue(validate_intent(self.request(), {'brief': {'prompt': 'Heavy breathing and yeah'}}))
        self.assertTrue(validate_evidence(self.evidence()))
        bad = self.request(); bad['plan']['lyrics'] = '[Verse]\nA real sentence'
        with self.assertRaisesRegex(ValueError, 'yeah-only'):
            validate_intent(bad, {'brief': {'prompt': 'Heavy breathing and yeah'}})
        with self.assertRaisesRegex(ValueError, 'sparse vocal span'):
            validate_evidence({**self.evidence(), 'voiced_energy_fraction': .02})

    def test_reviewed_local_spoken_jazz_reinterpretation_is_narrow(self):
        request = {'prompt_id': 'job-1:sparse-vocal-v1',
                   'directory': r'C:\state\jobs\job-1\sparse-vocal-attempt',
                   'voice_model': 'v8', 'plan': {'recipe': 'reinterpretation',
                   'lyrics': '[Verse]\nYeah\nMmm\nThat\'s right\nYeeaah\n[End]',
                   'arrangement': 'Smooth jazz with heavy breath texture.'}}
        planning = {'brief': {'prompt': 'Six minutes of heavy breathing and Tony saying yeah over smooth jazz',
                    'details': {'musicBackend': 'local', 'remixSource': {
                    'title': 'Yeah After Midnight',
                    'sha256': 'd0c85e6f241fe1cb959c011de784ba788c54e7164a5c609ff1cfa7c36bb244aa'}}}}
        self.assertEqual(validate_intent(request, planning), 'spoken_jazz_reinterpretation')
        evidence = {**self.evidence(), 'voiced_energy_fraction': .09}
        self.assertTrue(validate_evidence(evidence, .05))
        with self.assertRaisesRegex(ValueError, 'spoken-jazz'):
            planning['brief']['details']['remixSource']['sha256'] = 'wrong'
            validate_intent(request, planning)

    def test_reviewed_paid_spoken_jazz_reinterpretation_is_narrow(self):
        request = {'prompt_id': 'job-1', 'directory': r'C:\state\jobs\job-1',
                   'voice_model': 'v8', 'music_backend': 'eleven_music',
                   'plan': {'recipe': 'reinterpretation',
                            'lyrics': '[Verse]\nYeah\nYeeaah\n[End]',
                            'arrangement': 'Smooth jazz with close heavy breathing.'}}
        planning = {'brief': {'prompt': 'Six minutes of heavy breathing and Tony saying yeah over smooth jazz',
                    'details': {'musicBackend': 'eleven_music', 'remixSource': {
                    'title': 'Yeah After Midnight',
                    'sha256': 'd0c85e6f241fe1cb959c011de784ba788c54e7164a5c609ff1cfa7c36bb244aa'}}}}
        self.assertEqual(validate_intent(request, planning), 'paid_spoken_jazz_reinterpretation')
        self.assertTrue(validate_evidence_for_kind(
            {**self.evidence(), 'voiced_energy_fraction': .4638},
            'paid_spoken_jazz_reinterpretation'))
        for change in ('backend', 'source', 'lyrics', 'directory'):
            with self.subTest(change=change):
                candidate = {**request, 'plan': dict(request['plan'])}
                candidate_planning = {'brief': {'prompt': planning['brief']['prompt'],
                    'details': {**planning['brief']['details'],
                    'remixSource': dict(planning['brief']['details']['remixSource'])}}}
                if change == 'backend':
                    candidate['music_backend'] = 'local'
                elif change == 'source':
                    candidate_planning['brief']['details']['remixSource']['sha256'] = 'wrong'
                elif change == 'lyrics':
                    candidate['plan']['lyrics'] = '[Verse]\nA full sentence'
                else:
                    candidate['directory'] = r'C:\state\jobs\other'
                with self.assertRaises(ValueError):
                    validate_intent(candidate, candidate_planning)
    def test_first_longform_spoken_jazz_movement_has_bounded_span_policy(self):
        request = {'prompt_id': 'job:movement:1:sparse-vocal-v1', 'voice_model': 'v8',
                   'sparse_vocal_attempt': True,
                   'sparse_vocal_guidance': 'Vocal arrangement recovery: retain every supplied word.',
                   'suite_progress': {'index': 0, 'count': 3},
                   'plan': {'recipe': 'reinterpretation', 'title': 'Yeah After Midnight - Movement 1',
                            'lyrics': '[Verse]\nYeah, the room is blue after midnight',
                            'arrangement': 'Movement 1 of 3 in one connected song. Sparse opening calls and close breath texture.'}}
        planning = {'brief': {'prompt': 'Six minutes of heavy breathing and Tony saying yeah over smooth jazz',
                    'details': {'musicBackend': 'local', 'remixSource': {
                    'title': 'Yeah After Midnight',
                    'sha256': 'd0c85e6f241fe1cb959c011de784ba788c54e7164a5c609ff1cfa7c36bb244aa'}}}}
        kind = validate_intent(request, planning)
        self.assertEqual(kind, 'spoken_jazz_movement')
        evidence = {'duration': 221.6, 'first_detected_voice': 54.26,
                    'last_detected_voice': 145.5, 'voiced_energy_fraction': .1706,
                    'last_second_mix_dbfs': -60.1, 'estimated_word_count': 50}
        self.assertTrue(validate_evidence_for_kind(evidence, kind))
        with self.assertRaises(ValueError):
            validate_evidence_for_kind({**evidence, 'first_detected_voice': 70}, kind)
        planning['brief']['details']['musicBackend'] = 'eleven_music'
        with self.assertRaisesRegex(ValueError, 'suite movement'):
            validate_intent(request, planning)

    def test_standard_second_spoken_jazz_movement_uses_same_narrow_policy(self):
        request = {'prompt_id': 'job:movement:2', 'voice_model': 'v8',
                   'suite_progress': {'index': 1, 'count': 3},
                   'plan': {'recipe': 'reinterpretation',
                            'title': 'Yeah After Midnight - Movement 2',
                            'lyrics': '[Section]\nYeah, after midnight',
                            'arrangement': 'Movement 2 of 3 in one connected song. Close smoky jazz.'}}
        planning = {'brief': {'prompt': 'Six minutes of heavy breathing and Tony saying yeah over smooth jazz',
                    'details': {'musicBackend': 'local', 'remixSource': {
                    'title': 'Yeah After Midnight',
                    'sha256': 'd0c85e6f241fe1cb959c011de784ba788c54e7164a5c609ff1cfa7c36bb244aa'}}}}
        kind = validate_intent(request, planning)
        self.assertEqual(kind, 'spoken_jazz_movement')
        evidence = {'duration': 221.6, 'first_detected_voice': 6.36,
                    'last_detected_voice': 213.26, 'voiced_energy_fraction': .3927,
                    'last_second_mix_dbfs': -60.1, 'estimated_word_count': 64}
        self.assertTrue(validate_evidence_for_kind(evidence, kind))
        with self.assertRaisesRegex(ValueError, 'suite movement'):
            validate_intent({**request, 'prompt_id': 'job:movement:3'}, planning)
if __name__ == '__main__': unittest.main()

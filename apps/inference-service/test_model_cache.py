import unittest
from unittest.mock import patch

import app


class ModelCacheTests(unittest.TestCase):
    def tearDown(self):
        if hasattr(app, 'get_cached_model'):
            app.get_cached_model.cache_clear()

    def test_repeated_model_requests_reuse_loaded_object(self):
        with patch.object(app, 'load_model_uncached', create=True, side_effect=lambda *_: object()) as load:
            first = app.get_cached_model('lama', 'cpu')
            second = app.get_cached_model('lama', 'cpu')
            self.assertIs(first, second)
            self.assertEqual(load.call_count, 1)

    def test_single_entry_cache_evicts_previous_model_on_switch(self):
        with patch.object(app, 'load_model_uncached', create=True, side_effect=lambda *_: object()) as load:
            first = app.get_cached_model('lama', 'cpu')
            app.get_cached_model('migan', 'cpu')
            self.assertIsNot(first, app.get_cached_model('lama', 'cpu'))
            self.assertEqual(load.call_count, 3)


if __name__ == '__main__':
    unittest.main()

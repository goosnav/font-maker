import sys
sys.dont_write_bytecode = True
import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location('host', Path(__file__).parents[1] / 'app/src/goosnav_font/start.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class HostTests(unittest.TestCase):
    def test_origin_token_and_atomic_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'index.html').write_text('editor')
            server = host.make_server(root, root / 'data')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}'
            try:
                session = json.load(urllib.request.urlopen(url + '/api/session'))
                request = urllib.request.Request(url + '/api/recovery', b'PK\x03\x04example', method='PUT', headers={'Origin': 'https://attacker.example', 'X-Goosnav-Token': session['token']})
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(request)
                self.assertEqual(denied.exception.code, 403)
                request.headers['Origin'] = url
                self.assertTrue(json.load(urllib.request.urlopen(request))['saved'])
                self.assertEqual(urllib.request.urlopen(url + '/api/recovery').read(), b'PK\x03\x04example')
                self.assertFalse(list(root.rglob('*.partial-*')))
            finally:
                server.shutdown()
                server.server_close()

if __name__ == '__main__':
    unittest.main()

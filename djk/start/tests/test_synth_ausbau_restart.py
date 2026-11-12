"""Restart helper of the 64-knob build-out against a stub page server: a 32-row snapshot is restored as 64 rows per channel
(missing rows at the graph's vorgabe, a stored 0.5 stays 0.5), then exactly one POST /graph with vorgaben: false."""
import json, os, sys, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import synth_ausbau_restart as n  # noqa: E402

LOG = []
GELADEN = {'erz/6': 'synth-mono', 'pad/2': 'saege-ladder', 'erz/1': ''}
LAGE = {'erz/6/bk/1': 0.05, 'erz/6/bk/32': 0.25, 'erz/6/bk/40': 0.5, 'pad/2/bk/3': 0.7, 'deck/1/fader': -3}
PANEL = {'synth-mono': {'40': {'vorgabe': 0.0}, '41': {'vorgabe': 0.0}, '1': {'vorgabe': 0.5}}, 'saege-ladder': {}}


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def antwort(self, d):
        b = json.dumps(d).encode(); self.send_response(200); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path == '/graphen': return self.antwort({'geladen': GELADEN})
        if self.path == '/lage': return self.antwort({'regler': LAGE})
        if self.path.startswith('/graphen/panel?name='):
            return self.antwort({'regler': PANEL[self.path.split('=', 1)[1]]})
        self.send_response(404); self.end_headers()

    def do_POST(self):
        k = json.loads(self.rfile.read(int(self.headers['content-length'])))
        LOG.append((self.path, k)); self.antwort({'ok': True})


class Neustart(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(('127.0.0.1', 0), Stub)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.basis = f'http://127.0.0.1:{cls.srv.server_port}'

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def test_snapshot_nimmt_nur_geladene_kanaele_und_ihre_zeilen(self):
        s = n.snapshot(self.basis)
        self.assertEqual(sorted(s['kanaele']), ['erz/6', 'pad/2'])
        self.assertEqual(s['kanaele']['erz/6']['regler'], {'1': 0.05, '32': 0.25, '40': 0.5})

    def test_restore_zeilen_vor_graph_mit_vorgaben_aus(self):
        LOG.clear()
        n.restore(n.snapshot(self.basis), self.basis)
        for kanal, graph in (('erz/6', 'synth-mono'), ('pad/2', 'saege-ladder')):
            eigene = [(p, k) for p, k in LOG if k.get('kanal') == kanal or str(k.get('pfad', '')).startswith(kanal + '/')]
            regler = [k for p, k in eigene if p == '/regler']
            graphen = [k for p, k in eigene if p == '/graph']
            self.assertEqual(len(regler), 64)
            self.assertEqual(graphen, [{'kanal': kanal, 'name': graph, 'vorgaben': False}])
            self.assertEqual(eigene[-1][0], '/graph')   # rows first, graph last
        werte = {k['pfad']: k['nach'] for p, k in LOG if p == '/regler'}
        self.assertEqual(werte['erz/6/bk/40'], 0.5)   # stored 0.5 on a knob whose vorgabe is 0 stays 0.5
        self.assertEqual(werte['erz/6/bk/41'], 0.0)   # missing row: the graph's vorgabe
        self.assertEqual(werte['erz/6/bk/64'], 0.5)   # missing row, graph defines none: 0.5
        self.assertEqual(werte['pad/2/bk/3'], 0.7)


if __name__ == '__main__':
    unittest.main()

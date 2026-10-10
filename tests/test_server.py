import json
import os
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote

import server

class BrainApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.DB_PATH = __import__('pathlib').Path(cls.tmp.name) / 'brain.sqlite3'
        server.init_db()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.BrainHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join(timeout=2); cls.tmp.cleanup()

    def request(self, path, method='GET', data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = Request(self.base + path, data=body, method=method, headers={'Content-Type':'application/json'} if body else {})
        try:
            with urlopen(req) as r: return r.status, json.loads(r.read())
        except HTTPError as e: return e.code, json.loads(e.read())

    def test_create_retrieve_update_audit_delete_restore(self):
        code, item = self.request('/api/memories','POST',{'kind':'operational_memory','title':'Evidence first','content':'When a repository is empty, inspect branches before assuming a working tree.','work_id':'WORK-17','evidence_url':'https://example.com/proof','outcome':'No branches were present.','confidence':'confirmed','tags':['github','workflow']})
        self.assertEqual(code,201); mid=item['id']
        code, found = self.request('/api/retrieve?q=repository+branches')
        self.assertEqual(code,200); self.assertEqual(found['items'][0]['memory']['id'],mid)
        code, changed = self.request('/api/memories/'+mid,'PATCH',{'content':'Updated lesson after checking the live repo.'})
        self.assertEqual(code,200); self.assertEqual(changed['content'],'Updated lesson after checking the live repo.')
        code, hist = self.request('/api/memories/'+mid+'/history')
        self.assertEqual(code,200); self.assertEqual(len(hist['items']),2)
        code, deleted = self.request('/api/memories/'+mid,'DELETE')
        self.assertEqual(code,200); self.assertEqual(deleted['item']['status'],'deleted')
        code, found = self.request('/api/retrieve?q=repository')
        self.assertEqual(code,200); self.assertEqual(found['count'],0)
        code, restored = self.request('/api/memories/'+mid+'/restore','POST',{})
        self.assertEqual(code,200); self.assertEqual(restored['status'],'active')

    def test_thai_partial_retrieval(self):
        code, item = self.request('/api/memories','POST',{'kind':'operational_memory','title':'บทเรียนข้ามห้อง','content':'เก็บบทเรียนไว้ในแหล่งข้อมูลร่วมที่ห้องอื่นเข้าถึงได้'})
        self.assertEqual(code,201)
        code, found = self.request('/api/retrieve?q='+quote('ข้ามห้อง'))
        self.assertEqual(code,200)
        self.assertTrue(any(x['memory']['id']==item['id'] for x in found['items']))

    def test_validation_and_bad_evidence(self):
        code, error = self.request('/api/memories','POST',{'kind':'wrong','title':'x','content':'y'})
        self.assertEqual(code,400)
        code, error = self.request('/api/memories','POST',{'kind':'skill','title':'x','content':'y','evidence_url':'javascript:alert(1)'})
        self.assertEqual(code,400)

if __name__ == '__main__': unittest.main()

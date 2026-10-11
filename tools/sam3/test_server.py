import base64
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import numpy as np

spec = importlib.util.spec_from_file_location("sam_service", Path(__file__).with_name("server.py"))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ServiceTests(unittest.TestCase):
    def test_outline_and_detail_priority(self):
        importance = np.zeros((5, 5), dtype=np.uint8)
        mask = np.zeros((1, 5, 5), dtype=bool)
        mask[0, 1:4, 1:4] = True
        service.combine_masks(importance, mask, 64)
        self.assertEqual(importance[2, 2], 64)
        self.assertEqual(importance[0, 2], 230)
        service.combine_masks(importance, mask, 255)
        self.assertEqual(importance[2, 2], 255)
        self.assertEqual(importance[4, 4], 0)

    def test_multiple_heads_keep_features_and_ignore_eye_like_background(self):
        heads = np.zeros((3, 20, 30), dtype=bool)
        heads[0, 2:8, 2:8] = True
        heads[1, 2:8, 18:24] = True
        heads[2] = heads[0]
        boxes = service.face_boxes(heads, 30, 20)
        self.assertEqual(len(boxes), 2)
        support = service.feature_support(boxes, np.zeros((20,30), dtype=bool), 30, 20)
        features = np.zeros((3,20,30), dtype=bool)
        features[0,4,4] = features[1,4,20] = features[2,18,28] = True
        importance = np.zeros((20,30), dtype=np.uint8)
        recognition = np.zeros_like(importance)
        self.assertEqual(service.protect_features(importance, recognition, features, support), 2)
        self.assertEqual(recognition[4,4], 255)
        self.assertEqual(recognition[4,20], 255)
        self.assertEqual(recognition[18,28], 0)
        animal = np.zeros((20,30), dtype=bool)
        animal[10:15,10:15] = True
        self.assertTrue(np.array_equal(service.feature_support([], animal, 30, 20), animal))

    def test_hair_silhouette_and_protruding_accessories_are_protected(self):
        person = np.zeros((30,40),dtype=bool)
        person[8:25,10:25] = True
        support = service.human_detail_support(person,40,30)
        self.assertTrue(support[6,10])
        self.assertFalse(support[0,0])
        hair = np.zeros((1,30,40),dtype=bool)
        hair[0,5:13,10:25] = True
        importance = np.zeros((30,40),dtype=np.uint8)
        recognition = np.zeros_like(importance)
        self.assertEqual(service.protect_human_details(importance,recognition,hair,support,True),1)
        self.assertEqual(importance[9,17],230)
        self.assertEqual(recognition[9,17],0)
        self.assertEqual(recognition[5,17],255)
        pipe = np.zeros((2,30,40),dtype=bool)
        pipe[0,15:17,22:34] = True
        pipe[1,0:2,0:3] = True
        self.assertEqual(service.protect_human_details(importance,recognition,pipe,support),1)
        self.assertEqual(recognition[15,33],255)
        self.assertEqual(recognition[0,0],0)
        self.assertFalse(service.human_detail_support(np.zeros_like(person),40,30).any())
        for query in ("hair","eyeglasses","scarf","smoking pipe"):
            self.assertIn(query,service.HUMAN_DETAIL_QUERIES)

    def test_input_validation(self):
        rgba = base64.b64encode(bytes([1, 2, 3, 255])).decode()
        self.assertEqual(service.decode_image({"width": 1, "height": 1, "rgba": rgba}), (1, 1, bytes([1, 2, 3, 255])))
        for payload in ({"width": True, "height": 1}, {"width": 2048, "height": 1}, {"width": 1, "height": 1, "rgba": "bad"}):
            with self.assertRaises(ValueError):
                service.decode_image(payload)

    def test_http_contract_missing_weights_and_cors(self):
        service.Handler.analyzer = service.Analyzer(Path(__file__).with_name("nonexistent-test-weights.pt"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = "http://127.0.0.1:" + str(server.server_address[1])
        headers = {"Host": "127.0.0.1:8766", "Origin": "http://localhost:1420", "Content-Type": "application/json"}
        try:
            with urlopen(Request(url + "/health", headers=headers)) as response:
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:1420")
                self.assertFalse(json.load(response)["checkpointAvailable"])
            payload = json.dumps({"width": 1, "height": 1, "rgba": base64.b64encode(bytes(4)).decode()}).encode()
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url + "/analyze", data=payload, headers=headers))
            self.assertEqual(error.exception.code, 503)
            self.assertIn("weights are missing", json.load(error.exception)["error"])
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url + "/health", headers={**headers, "Origin": "https://example.com"}))
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url + "/health", headers={**headers, "Host": "other.example:8766"}))
            self.assertEqual(error.exception.code, 403)
            with urlopen(Request(url + "/analyze", method="OPTIONS", headers=headers)) as response:
                self.assertEqual(response.status, 204)
            service.Handler.analyzer.lock.acquire()
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url + "/analyze", data=payload, headers=headers))
            self.assertEqual(error.exception.code, 429)
            service.Handler.analyzer.lock.release()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

if __name__ == "__main__":
    unittest.main()

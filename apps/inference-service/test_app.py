import io
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image, ImageCms

import app as service


def png(array):
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format='PNG')
    return buffer.getvalue()


class Tests(unittest.TestCase):
    def test_slbr_detector_uses_first_mask_from_official_model_output(self):
        class FakeSLBR:
            def __call__(self, image):
                mask = service.torch.full((1, 1, 256, 256), 0.75, device=image.device)
                return [image], [mask], None
        image = np.full((10, 16, 3), 60, dtype=np.uint8)
        with patch.object(service, 'device', return_value='cpu'), patch.object(service, 'get_cached_model', return_value=FakeSLBR()):
            scores = service.detect_serial(image)
        self.assertEqual(scores.shape, (10, 16))
        self.assertTrue(np.all(scores == 191))

    def test_slbr_detection_exposes_mask_and_shares_inference_lane(self):
        image = np.full((12, 16, 3), 60, dtype=np.uint8)
        expected = np.zeros((12, 16), dtype=np.uint8)
        expected[2:6, 4:8] = 180
        with patch.object(service, 'TOKEN', 'test-token'), patch.object(service, 'available', return_value=(True, None)), \
             patch.object(service, 'run_serial', side_effect=lambda _model, source, _mask: source), \
             patch.object(service, 'detect_serial', return_value=expected):
            with TestClient(service.app) as client:
                headers = {'Authorization': 'Bearer test-token'}
                models = client.get('/v1/models', headers=headers).json()['models']
                self.assertIn('detect', next(item for item in models if item['id'] == 'slbr')['features'])
                self.assertNotIn('detect', next(item for item in models if item['id'] == 'lama')['features'])
                files = {'image': ('image.png', png(image), 'image/png')}
                self.assertEqual(client.post('/v1/detect', data={'jobId': 'd1'}, files=files).status_code, 401)
                response = client.post('/v1/detect', data={'jobId': 'd1'}, files=files, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                np.testing.assert_array_equal(np.asarray(Image.open(io.BytesIO(response.content))), expected)
                service.lane = service.asyncio.Semaphore(0)
                try:
                    self.assertEqual(client.post('/v1/detect', data={'jobId': 'd2'}, files=files, headers=headers).status_code, 429)
                finally:
                    service.lane = service.asyncio.Semaphore(1)

    def test_migan_mask_polarity_and_pixels_outside_mask(self):
        image = np.full((16, 16, 3), 60, dtype=np.uint8)
        mask = np.zeros((16, 16), dtype=np.uint8)
        mask[4:12, 4:12] = 255

        class Session:
            def __init__(self, *_args, **_kwargs):
                pass

            def run(self, _outputs, inputs):
                np.testing.assert_array_equal(inputs['mask'][0, 0], 255 - mask)
                return [np.full((1, 3, 16, 16), 200, dtype=np.uint8)]

        with patch('onnxruntime.InferenceSession', Session), patch.object(service, 'device', return_value='cpu'):
            result = service.run_model('migan', image, mask)
        np.testing.assert_array_equal(result[mask == 0], image[mask == 0])
        self.assertTrue(np.all(result[mask != 0] == 200))

    def test_http_auth_and_source_dimensions(self):
        image = np.full((16, 16, 3), 60, dtype=np.uint8)
        mask = np.zeros((16, 16), dtype=np.uint8)
        mask[4:12, 4:12] = 255
        with patch.object(service, 'TOKEN', 'test-token'), patch.object(service, 'available', return_value=(True, None)), \
             patch.object(service, 'run_serial', side_effect=lambda _model, source, _mask: source):
            with TestClient(service.app) as client:
                self.assertEqual(client.get('/v1/models').status_code, 401)
                headers = {'Authorization': 'Bearer test-token'}
                files = {'image': ('image.png', png(image), 'image/png'), 'mask': ('mask.png', png(mask), 'image/png')}
                response = client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'job-1'}, files=files, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(Image.open(io.BytesIO(response.content)).size, (16, 16))
                wrong = {'image': files['image'], 'mask': ('mask.png', png(mask[:8]), 'image/png')}
                self.assertEqual(client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'job-2'}, files=wrong, headers=headers).status_code, 400)
                oversized = {**headers, 'content-length': str(service.MAX_BYTES * 2 + 65537)}
                self.assertEqual(client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'job-3'}, files=files, headers=oversized).status_code, 413)

    def test_transparency_and_concurrent_admission(self):
        image = np.full((16, 16, 4), 60, dtype=np.uint8)
        image[:, :, 3] = np.arange(16, dtype=np.uint8)[None, :] * 16
        mask = np.zeros((16, 16), dtype=np.uint8); mask[4:12, 4:12] = 255
        with patch.object(service, 'TOKEN', ''), patch.object(service, 'available', return_value=(True, None)), \
             patch.object(service, 'run_serial', side_effect=lambda _model, source, _mask: source):
            with TestClient(service.app) as client:
                files = {'image': ('image.png', png(image), 'image/png'), 'mask': ('mask.png', png(mask), 'image/png')}
                response = client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'alpha'}, files=files)
                self.assertEqual(response.status_code, 200, response.text)
                result = np.asarray(Image.open(io.BytesIO(response.content)).convert('RGBA'))
                np.testing.assert_array_equal(result, image)
                service.lane = service.asyncio.Semaphore(0)
                try:
                    response = client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'busy'}, files=files)
                    self.assertEqual(response.status_code, 429, response.text)
                finally:
                    service.lane = service.asyncio.Semaphore(1)

    def test_rgb_profile_survives_repair(self):
        image = Image.new('RGB', (16, 16), (50, 80, 100))
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        buffer = io.BytesIO(); image.save(buffer, format='PNG', icc_profile=profile)
        mask = np.full((16, 16), 255, dtype=np.uint8)
        with patch.object(service, 'TOKEN', ''), patch.object(service, 'available', return_value=(True, None)), \
             patch.object(service, 'run_serial', side_effect=lambda _model, source, _mask: source):
            with TestClient(service.app) as client:
                files = {'image': ('image.png', buffer.getvalue(), 'image/png'), 'mask': ('mask.png', png(mask), 'image/png')}
                response = client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'icc'}, files=files)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(Image.open(io.BytesIO(response.content)).info.get('icc_profile'), profile)

    def test_high_bit_depth_source_is_rejected(self):
        image = np.full((16, 16), 1000, dtype=np.uint16)
        with self.assertRaisesRegex(ValueError, '高位深'):
            service.read_source(png(image))

    def test_thin_mask_survives_downsampling(self):
        mask = np.zeros((5000, 8000), dtype=np.uint8)
        mask[:, 7999] = 1
        resized = service.resize_mask(mask, 1024, 640)
        self.assertTrue(resized.any())
        self.assertTrue(resized[:, -1].all())

    def test_stalled_upload_releases_lane(self):
        async def check():
            async def slow_body():
                await service.asyncio.sleep(0.3)
                yield b'--x--\r\n'
            transport = httpx.ASGITransport(app=service.app)
            async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
                headers = {'content-type': 'multipart/form-data; boundary=x', 'content-length': '7'}
                response = await client.post('/v1/inpaint', content=slow_body(), headers=headers)
                self.assertEqual(response.status_code, 408, response.text)
                self.assertFalse(service.lane.locked())
        with patch.object(service, 'TOKEN', ''), patch.object(service, 'UPLOAD_TIMEOUT_SECONDS', 0.05, create=True):
            service.asyncio.run(check())

    def test_finished_upload_is_not_timed_out_during_inference(self):
        image = np.full((16, 16, 3), 60, dtype=np.uint8)
        mask = np.full((16, 16), 255, dtype=np.uint8)
        def slow(_model, source, _mask):
            time.sleep(0.15)
            return source
        with patch.object(service, 'TOKEN', ''), patch.object(service, 'UPLOAD_TIMEOUT_SECONDS', 0.05), \
             patch.object(service, 'available', return_value=(True, None)), patch.object(service, 'run_serial', side_effect=slow):
            with TestClient(service.app) as client:
                files = {'image': ('image.png', png(image), 'image/png'), 'mask': ('mask.png', png(mask), 'image/png')}
                response = client.post('/v1/inpaint', data={'model': 'migan', 'jobId': 'slow-model'}, files=files)
                self.assertEqual(response.status_code, 200, response.text)

    def test_cancelled_request_keeps_lane_until_worker_exits(self):
        async def check():
            started, finish = threading.Event(), threading.Event()
            def work():
                started.set()
                finish.wait(3)
            async def receive():
                return {'type': 'http.request', 'body': b'', 'more_body': False}
            request = SimpleNamespace(method='POST', url=SimpleNamespace(path='/v1/inpaint'),
                                      headers={'content-length': '1'}, receive=receive)
            task = service.asyncio.create_task(service.limit_requests(request, lambda _request: service.run_blocking(work)))
            await service.asyncio.to_thread(started.wait, 1)
            self.assertTrue(started.is_set())
            task.cancel()
            await service.asyncio.sleep(0.05)
            self.assertTrue(service.lane.locked())
            finish.set()
            with self.assertRaises(service.asyncio.CancelledError):
                await task
            self.assertFalse(service.lane.locked())
        with patch.object(service, 'TOKEN', ''):
            service.asyncio.run(check())

    def test_repeated_cancellation_does_not_lock_lane(self):
        async def check():
            started, finish = threading.Event(), threading.Event()
            def work():
                started.set()
                finish.wait(3)
            async def receive():
                return {'type': 'http.request', 'body': b'', 'more_body': False}
            request = SimpleNamespace(method='POST', url=SimpleNamespace(path='/v1/inpaint'),
                                      headers={'content-length': '1'}, receive=receive)
            task = service.asyncio.create_task(service.limit_requests(request, lambda _request: service.run_blocking(work)))
            await service.asyncio.to_thread(started.wait, 1)
            self.assertTrue(started.is_set())
            task.cancel(); await service.asyncio.sleep(0.05)
            task.cancel(); await service.asyncio.sleep(0.05)
            finish.set()
            with self.assertRaises(service.asyncio.CancelledError):
                await task
            await service.asyncio.sleep(0.1)
            self.assertFalse(service.lane.locked())
        with patch.object(service, 'TOKEN', ''):
            service.asyncio.run(check())


if __name__ == '__main__':
    unittest.main()

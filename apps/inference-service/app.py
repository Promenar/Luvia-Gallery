"""图库本地修复推理服务。模型与权重由部署环境提供。"""

import asyncio
import gc
import hmac
import io
import logging
import math
import os
import sys
import threading
import types
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageCms, ImageOps

MODEL_DIR = Path(os.environ.get('MODEL_DIR', '/models'))
SLBR_SOURCE = Path(os.environ.get('SLBR_SOURCE_DIR', '/slbr'))
TOKEN = os.environ.get('EDITOR_SERVICE_TOKEN', '')
DEVICE = os.environ.get('EDITOR_DEVICE', 'auto')
MAX_PIXELS = int(os.environ.get('EDITOR_MAX_PIXELS', '40000000'))
MAX_BYTES = int(os.environ.get('EDITOR_MAX_INPUT_BYTES', str(128 * 1024 * 1024)))
UPLOAD_TIMEOUT_SECONDS = float(os.environ.get('EDITOR_UPLOAD_TIMEOUT_SECONDS', '120'))
MODEL_FILES = {'lama': 'big-lama.pt', 'migan': 'migan_pipeline_v2.onnx', 'slbr': 'slbr.pth'}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
lane = asyncio.Semaphore(1)
gpu_lock = threading.Lock()
cancelled = set()
active_jobs = set()
cancel_lock = threading.Lock()
model_status = {}


def authenticate(value):
    if TOKEN and not hmac.compare_digest(value or '', 'Bearer ' + TOKEN):
        raise HTTPException(401, '未授权')


@app.middleware('http')
async def limit_requests(request: Request, call_next):
    if TOKEN and not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + TOKEN):
        return JSONResponse({'detail': '未授权'}, status_code=401)
    if request.method != 'POST' or request.url.path != '/v1/inpaint':
        return await call_next(request)
    try:
        length = int(request.headers.get('content-length', ''))
    except ValueError:
        return JSONResponse({'detail': '请求缺少有效长度'}, status_code=411)
    if length < 0 or length > 2 * MAX_BYTES + 65536:
        return JSONResponse({'detail': '请求体超过大小限制'}, status_code=413)
    if lane.locked():
        return JSONResponse({'detail': '推理服务正忙'}, status_code=429)
    await lane.acquire()
    receive = request.receive
    deadline = asyncio.get_running_loop().time() + UPLOAD_TIMEOUT_SECONDS
    body_complete = False
    upload_timed_out = False
    async def receive_with_deadline():
        nonlocal body_complete, upload_timed_out
        if body_complete:
            return await receive()
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            upload_timed_out = True
            raise HTTPException(408, '上传超时')
        try:
            message = await asyncio.wait_for(receive(), timeout=remaining)
            if message['type'] == 'http.disconnect' or (message['type'] == 'http.request' and not message.get('more_body', False)):
                body_complete = True
            return message
        except TimeoutError as error:
            upload_timed_out = True
            raise HTTPException(408, '上传超时') from error
    request._receive = receive_with_deadline
    try:
        response = await call_next(request)
        if upload_timed_out:
            return JSONResponse({'detail': '上传超时'}, status_code=408)
        return response
    finally:
        lane.release()


def device():
    if DEVICE == 'cpu':
        return 'cpu'
    if DEVICE == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA 不可用')
    return 'cuda' if torch.cuda.is_available() else 'cpu'


def available(model):
    if model in model_status:
        return model_status[model]
    if not (MODEL_DIR / MODEL_FILES[model]).is_file():
        return False, '模型权重未配置'
    if model == 'slbr' and not (SLBR_SOURCE / 'src/networks/resunet.py').is_file():
        return False, 'SLBR 上游模型代码未配置'
    try:
        device()
        return True, None
    except RuntimeError as error:
        return False, str(error)


def read_image(data, mode):
    if len(data) > MAX_BYTES:
        raise ValueError('图片超过大小限制')
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > MAX_PIXELS:
            raise ValueError('图片超过像素限制')
        return np.asarray(ImageOps.exif_transpose(image).convert(mode)).copy()


def read_source(data):
    if len(data) > MAX_BYTES:
        raise ValueError('图片超过大小限制')
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > MAX_PIXELS:
            raise ValueError('图片超过像素限制')
        png_16bit = image.format == 'PNG' and len(data) > 24 and data[24] > 8
        tiff_bits = getattr(image, 'tag_v2', {}).get(258, (8,))
        if isinstance(tiff_bits, int):
            tiff_bits = (tiff_bits,)
        if image.mode in ('I', 'F', 'I;16', 'I;16B', 'I;16L') or png_16bit or any(value > 8 for value in tiff_bits):
            raise ValueError('暂不支持高位深图片修复')
        profile = image.info.get('icc_profile')
        image = ImageOps.exif_transpose(image)
        if profile and image.mode not in ('RGB', 'RGBA', 'P'):
            try:
                alpha = image.convert('RGBA').getchannel('A')
                source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile))
                target_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
                image = ImageCms.profileToProfile(image, source_profile, target_profile, outputMode='RGB').convert('RGBA')
                image.putalpha(alpha)
                profile = target_profile.tobytes()
            except Exception as error:
                raise ValueError('无法转换图片色彩配置') from error
        return np.asarray(image.convert('RGBA')).copy(), profile


def resize_mask(mask, width, height):
    """缩小蒙版时扩展覆盖范围，防止细线在采样时消失。"""
    import cv2
    source = mask.astype(np.uint8) * 255
    if width < mask.shape[1] or height < mask.shape[0]:
        kernel = (max(1, math.ceil(mask.shape[1] / width) + 1), max(1, math.ceil(mask.shape[0] / height) + 1))
        source = cv2.dilate(source, np.ones((kernel[1], kernel[0]), dtype=np.uint8))
    result = np.asarray(Image.fromarray(source).resize((width, height), Image.Resampling.NEAREST)).copy()
    if mask.any() and not result.any():
        raise ValueError('蒙版缩放后不可用')
    return result


def run_model(model_id, image, mask):
    """只在用户蒙版内合成结果，输入输出保持相同尺寸。"""
    height, width = mask.shape
    selected = mask > 127
    if not selected.any():
        raise ValueError('蒙版为空')
    target = device()
    if model_id == 'migan':
        import onnxruntime as ort
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if target == 'cuda' else ['CPUExecutionProvider']
        session = ort.InferenceSession(str(MODEL_DIR / MODEL_FILES[model_id]), providers=providers)
        if target == 'cuda' and 'CUDAExecutionProvider' not in session.get_providers():
            raise RuntimeError('ONNX CUDA 不可用')
        known = np.full(mask.shape, 255, dtype=np.uint8); known[selected] = 0
        inputs = {'image': image.transpose(2, 0, 1)[None], 'mask': known[None, None]}
        out = session.run(None, inputs)[0][0].transpose(1, 2, 0)
        del session
    elif model_id == 'lama':
        import torch.nn.functional as functional
        model = torch.jit.load(str(MODEL_DIR / MODEL_FILES[model_id]), map_location=target).eval()
        # 局部裁剪并限制模型输入，降低显存消耗；最终画布仍保留原始尺寸。
        ys, xs = np.flatnonzero(selected.any(axis=1)), np.flatnonzero(selected.any(axis=0))
        margin = max(64, int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.25))
        x0, x1 = max(0, int(xs.min()) - margin), min(width, int(xs.max()) + margin + 1)
        y0, y1 = max(0, int(ys.min()) - margin), min(height, int(ys.max()) + margin + 1)
        crop, local_mask = image[y0:y1, x0:x1], selected[y0:y1, x0:x1]
        scale = min(1.0, 1024 / max(crop.shape[:2]))
        rw, rh = max(8, round(crop.shape[1] * scale)), max(8, round(crop.shape[0] * scale))
        resized = np.asarray(Image.fromarray(crop).resize((rw, rh), Image.Resampling.LANCZOS)).copy()
        mask_small = resize_mask(local_mask, rw, rh)
        x = torch.from_numpy(resized.transpose(2, 0, 1)).unsqueeze(0).float().to(target) / 255
        m = torch.from_numpy(mask_small).unsqueeze(0).unsqueeze(0).float().to(target) / 255
        padding = (0, (8 - rw % 8) % 8, 0, (8 - rh % 8) % 8)
        with torch.inference_mode():
            result = model(functional.pad(x, padding, mode='replicate'), functional.pad(m, padding))
        result = result[0, :, :rh, :rw].permute(1, 2, 0).clamp(0, 1).cpu().numpy()
        result = np.asarray(Image.fromarray((result * 255).astype(np.uint8)).resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS))
        out = image.copy(); out[y0:y1, x0:x1] = result
        del model, x, m
    else:
        from importlib import import_module
        src = types.ModuleType('src'); src.__path__ = [str(SLBR_SOURCE / 'src')]; sys.modules['src'] = src
        utils = types.ModuleType('src.utils'); utils.__path__ = [str(SLBR_SOURCE / 'src/utils')]; sys.modules['src.utils'] = utils
        slbr = import_module('src.networks').slbr
        args = SimpleNamespace(mask_mode='res', sim_metric='cos', k_center=2, project_mode='simple', bg_mode='res_mask', use_refine=True, k_refine=3, k_skip_stage=3)
        model = slbr(args=args)
        checkpoint = torch.load(MODEL_DIR / MODEL_FILES[model_id], map_location='cpu', weights_only=True)
        model.load_state_dict(checkpoint['state_dict'], strict=True); model = model.eval().to(target)
        # 官方权重按 256×256 训练；输出映射到原图，最后只合成用户选择的区域。
        resized = np.asarray(Image.fromarray(image).resize((256, 256), Image.Resampling.LANCZOS)).copy()
        x = torch.from_numpy(resized.transpose(2, 0, 1)).unsqueeze(0).float().to(target) / 255
        with torch.inference_mode():
            predicted, detected, _ = model(x)
            result = predicted[0] * detected[0] + x * (1 - detected[0])
        result = result[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy()
        out = np.asarray(Image.fromarray((result * 255).astype(np.uint8)).resize((width, height), Image.Resampling.LANCZOS))
        del model, x
    output = image.copy(); output[selected] = out[selected]
    gc.collect()
    if target == 'cuda':
        torch.cuda.empty_cache()
    return output


def run_serial(model_id, image, mask):
    # 即使客户端中断连接，后台线程结束前也不允许下一次推理占用 GPU。
    with gpu_lock:
        return run_model(model_id, image, mask)


@app.on_event('startup')
async def initialize():
    # 权重存在不等于模型能执行；用小图实际加载并运行后才公布可用。
    image = np.full((256, 256, 3), 128, dtype=np.uint8)
    mask = np.zeros((256, 256), dtype=np.uint8); mask[96:160, 96:160] = 255
    for name in MODEL_FILES:
        ready, reason = available(name)
        if ready:
            try:
                result = await asyncio.to_thread(run_serial, name, image, mask)
                if result.shape != image.shape or not np.array_equal(result[mask == 0], image[mask == 0]):
                    raise ValueError('结果尺寸或蒙版不匹配')
            except Exception:
                logging.exception('模型 %s 初始化失败', name)
                ready, reason = False, '模型初始化或推理失败，请检查服务日志和运行环境'
        model_status[name] = (ready, reason)


@app.get('/v1/models')
async def models(authorization: str | None = Header(default=None)):
    authenticate(authorization)
    models = []
    for name in MODEL_FILES:
        ready, reason = available(name)
        models.append({'id': name, 'available': ready, 'reason': reason, 'device': device() if ready else None,
                       'maxPixels': MAX_PIXELS, 'features': ['mask']})
    return {'models': models}


@app.post('/v1/inpaint')
async def inpaint(model: str = Form(...), jobId: str = Form(...), image: UploadFile = File(...),
                  mask: UploadFile = File(...), authorization: str | None = Header(default=None)):
    authenticate(authorization)
    if model not in MODEL_FILES or not available(model)[0]:
        raise HTTPException(409, '模型不可用')
    with cancel_lock:
        if jobId in active_jobs:
            raise HTTPException(409, '作业编号已在使用')
        active_jobs.add(jobId)
    try:
        image_data = await image.read(MAX_BYTES + 1); mask_data = await mask.read(MAX_BYTES + 1)
        (original, profile), selection = await asyncio.to_thread(lambda: (read_source(image_data), read_image(mask_data, 'L')))
        if original.shape[:2] != selection.shape:
            raise ValueError('图片和蒙版尺寸不一致')
        with cancel_lock:
            if jobId in cancelled:
                raise HTTPException(409, '作业已取消')
        result = await asyncio.to_thread(run_serial, model, original[:, :, :3].copy(), selection)
        def encode():
            rgba = np.dstack((result, original[:, :, 3])); output = io.BytesIO()
            Image.fromarray(rgba).save(output, format='PNG', **({'icc_profile': profile} if profile else {}))
            return output.getvalue()
        data = await asyncio.to_thread(encode)
        with cancel_lock:
            if jobId in cancelled:
                raise HTTPException(409, '作业已取消')
        return Response(data, media_type='image/png')
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    finally:
        with cancel_lock:
            active_jobs.discard(jobId)
            cancelled.discard(jobId)


@app.post('/v1/cancel/{job_id}', status_code=204)
async def cancel(job_id: str, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    with cancel_lock:
        if job_id in active_jobs:
            cancelled.add(job_id)
    return Response(status_code=204)

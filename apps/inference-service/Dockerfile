FROM pytorch/pytorch:2.7.0-cuda12.6-cudnn9-runtime

RUN pip install --no-cache-dir \
    onnxruntime-gpu==1.22.0 fastapi==0.115.6 uvicorn==0.30.0 \
    python-multipart==0.0.32 pillow==12.3.0 numpy==1.26.4 scipy==1.17.1 \
    opencv-python-headless==4.11.0.86

WORKDIR /app
COPY --chmod=0644 app.py /app/app.py
USER 65534:65534
EXPOSE 8090
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]

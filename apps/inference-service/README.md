# 图像修复推理服务

该服务接收原图和白色为修复区域的蒙版，在本机执行模型并返回原始宽高的 PNG。输出只替换用户选择的像素。模型独立加载，默认单次执行一个推理任务；支持 CUDA 或 CPU，采用能力探测确认模型实际可用。

服务从 `MODEL_DIR`（默认 `/models`）读取 `big-lama.pt`、`migan_pipeline_v2.onnx` 和 `slbr.pth`。SLBR 上游源码由 `SLBR_SOURCE_DIR`（默认 `/slbr`）提供；权重和源码不包含在镜像内。准备模型前应核对来源、版本、许可和哈希。修改权重后重启服务以重新检查能力。

`EDITOR_DEVICE` 可设为 `auto`、`cuda` 或 `cpu`；`EDITOR_MAX_PIXELS` 默认为 4000 万；`EDITOR_MAX_INPUT_BYTES` 默认为 128 MiB；`EDITOR_UPLOAD_TIMEOUT_SECONDS` 默认为 120 秒。可配置 `EDITOR_SERVICE_TOKEN` 用于服务间认证。服务应仅连接受限容器网络，不直接暴露到公网。目前的作业准入和取消状态由单进程持有，必须以单实例、单 Uvicorn 进程运行。

LaMa 对蒙版周边裁剪，最长边缩放至 1024 后推理并合回原尺寸；MI-GAN 使用官方 ONNX 完整管线，并转换其已知区域为白色的蒙版约定；SLBR 使用官方 256 像素模型输出与其检测蒙版。输出保留透明通道及 RGB 图像的色彩配置；其他带色彩配置的模式转换到 sRGB。大范围修复可能出现局部细节变软，最终效果需要使用实际图片验证。服务不会修改输入文件。

接口为 `GET /v1/models`、`POST /v1/inpaint` 和 `POST /v1/cancel/:jobId`，其参数与图库编辑器的[推理服务契约](../../docs/MEDIA_FAILURE_AND_EDITOR_DESIGN.md)一致。推理和编码阶段取消后会丢弃结果，不能强制中断已启动的 GPU 运算；上传阶段和响应发送阶段由客户端中止传输。

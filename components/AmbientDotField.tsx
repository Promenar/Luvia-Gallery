import React, { useEffect, useRef, useState } from 'react';

// 画布容器样式：固定铺满视口、置于内容层之下、永不拦截指针事件。
// 鼠标/触摸跟随通过 window 级监听采集，不依赖 canvas 自身事件。
const CONTAINER_CLASSES = 'fixed inset-0 z-0 block h-full w-full pointer-events-none';

// 顶点着色器：全屏两个三角形，直接输出裁剪坐标（移植自参考页 Deep Cosmic Dot Matrix）。
const VS_SOURCE = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

// 片元着色器：微缩密集点阵 + 软光晕衰减 + 深邃调色。
// 光源轨道、衰减次幂、双层羽化与辉光参数保持参考页原值，不做调参。
const FS_SOURCE = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_dpr;
      uniform float u_time;
      uniform vec2 u_mouse;

      void main() {
        vec2 coord = gl_FragCoord.xy / u_dpr;
        vec2 res = u_resolution / u_dpr;

        // 1. 更密更细的点阵网格（间距缩减至 9.5px）
        float spacing = 9.5;
        vec2 grid_uv = fract(coord / spacing) - 0.5;
        vec2 cell_center = (floor(coord / spacing) + 0.5) * spacing;
        float dist_in_dot = length(grid_uv); // 当前像素距离小圆点中心的偏移 (0.0 ~ 0.5)

        // 2. 呼吸与多重游离光源
        float t = u_time * 0.45;
        vec2 light_mouse = u_mouse;

        // 幽蓝暗流
        vec2 light_indigo = res * 0.5 + vec2(
          sin(t * 0.8) * (res.x * 0.32),
          cos(t * 0.6) * (res.y * 0.28)
        );
        // 紫罗兰星云
        vec2 light_violet = res * 0.5 + vec2(
          cos(t * 0.5 + 1.2) * (res.x * 0.38),
          sin(t * 0.7 + 0.8) * (res.y * 0.25)
        );
        // 冷青辅光
        vec2 light_cyan = res * 0.5 + vec2(
          sin(t * 1.1 - 2.0) * (res.x * 0.22),
          cos(t * 0.9 + 1.5) * (res.y * 0.35)
        );

        // 3. 高次幂衰减（非线性曲线让边缘迅速融入黑夜，深邃感的核心）
        float max_r = min(res.x, res.y) * 0.65;

        float dist_m = length(cell_center - light_mouse);
        float dist_i = length(cell_center - light_indigo);
        float dist_v = length(cell_center - light_violet);
        float dist_c = length(cell_center - light_cyan);

        // 采用 2.2~3.0 次方衰减，光心强，四周长距离微光
        float int_m = pow(clamp(1.0 - dist_m / (max_r * 0.85), 0.0, 1.0), 2.4);
        float int_i = pow(clamp(1.0 - dist_i / (max_r * 1.15), 0.0, 1.0), 2.6);
        float int_v = pow(clamp(1.0 - dist_v / (max_r * 1.05), 0.0, 1.0), 2.5);
        float int_c = pow(clamp(1.0 - dist_c / (max_r * 0.95), 0.0, 1.0), 2.8);

        float total_field = clamp(int_m * 1.2 + int_i * 0.85 + int_v * 0.9 + int_c * 0.6, 0.0, 1.2);

        // 4. 深邃星云色彩调配（深海靛青、夜空紫罗兰、核心淡粉青）
        vec3 col_abyss   = vec3(0.015, 0.04, 0.12);  // 边缘隐约蓝灰底
        vec3 col_indigo  = vec3(0.08, 0.18, 0.68);   // 幽深靛蓝
        vec3 col_violet  = vec3(0.42, 0.08, 0.62);   // 神秘紫红
        vec3 col_cyan    = vec3(0.06, 0.45, 0.65);   // 冷青
        vec3 col_highlight = vec3(0.72, 0.65, 0.95); // 核心微高光

        vec3 glow_color = col_abyss;
        glow_color = mix(glow_color, col_indigo, int_i * 1.2);
        glow_color = mix(glow_color, col_violet, int_v * 1.15);
        glow_color = mix(glow_color, col_cyan, int_c * 0.9);
        glow_color = mix(glow_color, col_highlight, int_m * 1.1);

        // 5. 极小点阵与超软羽化（Gaussian/指数式光斑，边缘不再生硬）
        // 半径上限严格压制，亮处最大仅占网格 0.22
        float radius = mix(0.03, 0.22, clamp(total_field, 0.0, 1.0));

        // 双层柔和羽化：柔光晕 (halo) + 紧凑亮芯 (core)
        float soft_feather = radius * 1.8;
        float dot_halo = smoothstep(soft_feather, 0.0, dist_in_dot);
        float dot_core = smoothstep(radius * 0.6, 0.0, dist_in_dot);
        float dot_mask = dot_halo * 0.55 + dot_core * 0.65;

        // 6. 微环境漫反射辉光（营造星尘悬浮于黑暗深海的质感）
        float ambient_fog = pow(total_field, 3.0) * 0.08;

        // 7. 纯正黑底合成
        vec3 pitch_black = vec3(0.005, 0.008, 0.018);
        vec3 final_rgb = pitch_black + glow_color * (dot_mask * total_field + ambient_fog);

        gl_FragColor = vec4(final_rgb, 1.0);
      }
    `;

type InitStatus = 'pending' | 'ready' | 'unsupported';

/**
 * WebGL 点阵光场背景。
 *
 * 设计守卫：
 * - WebGL 不可用时静默返回 null（保留根容器 bg-surface-primary 底色），绝不 alert；
 * - document.hidden 时暂停 rAF，恢复可见时续播；
 * - prefers-reduced-motion: reduce 时只渲染一帧静态光场，不启动动画循环；
 * - dpr 上限 2，resize 时重建 viewport 与 uniform；
 * - 动画循环内零 setState：鼠标位置走 ref + uniform 上传，循环只影响自身 canvas；
 * - 卸载完整清理：rAF、window/document 监听、buffer/program/shader、loseContext、canvas 节点。
 *
 * canvas 由 effect 命令式创建（而非 JSX 渲染）：StrictMode 双跑时每次 effect
 * 都拿到全新 canvas 元素，避免上一轮 cleanup 的 loseContext 污染复用的上下文。
 */
export const AmbientDotField: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 仅在挂载初始化时 setState 一次，动画循环内绝不触碰。
  const [status, setStatus] = useState<InitStatus>('pending');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setStatus('unsupported');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      container.removeChild(canvas);
      setStatus('unsupported');
      return;
    }

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[AmbientDotField] 着色器编译失败:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = createShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    const program = gl.createProgram();
    if (!vertexShader || !fragmentShader || !program) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      if (program) gl.deleteProgram(program);
      container.removeChild(canvas);
      setStatus('unsupported');
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[AmbientDotField] 着色器程序链接失败');
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
      container.removeChild(canvas);
      setStatus('unsupported');
      return;
    }
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );
    const posAttr = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uDpr = gl.getUniformLocation(program, 'u_dpr');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');

    // ---- 循环状态全部保存在局部变量/ref 中，rAF 内不做任何 React 更新 ----
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetMouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45 };
    const currentMouse = { x: targetMouse.x, y: targetMouse.y };
    let elapsed = 0;
    let lastFrameTime = performance.now();
    let rafId: number | null = null;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uDpr, dpr);
      // 静态模式下重建 viewport 后补一帧，避免画布空白
      if (reducedMotionQuery.matches) drawFrame(0);
    };

    // 上传逐帧 uniform 并绘制一帧；鼠标经 0.04 迟滞阻尼产生厚重的流体跟随感。
    const drawFrame = (dt: number) => {
      elapsed += dt;
      currentMouse.x += (targetMouse.x - currentMouse.x) * 0.04;
      currentMouse.y += (targetMouse.y - currentMouse.y) * 0.04;
      gl.uniform1f(uTime, elapsed);
      gl.uniform2f(uMouse, currentMouse.x, currentMouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const frame = (now: number) => {
      rafId = null;
      const dt = (now - lastFrameTime) * 0.001;
      lastFrameTime = now;
      drawFrame(dt);
      rafId = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (rafId !== null || reducedMotionQuery.matches) return;
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(frame);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    // 页面隐藏暂停 rAF，恢复可见续播（时间轴用增量累计，续播不跳帧）。
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      targetMouse.x = e.clientX;
      targetMouse.y = window.innerHeight - e.clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        targetMouse.x = e.touches[0].clientX;
        targetMouse.y = window.innerHeight - e.touches[0].clientY;
      }
    };

    resize();
    if (reducedMotionQuery.matches) {
      // 减弱动态偏好：只渲染一帧静态光场，不启动动画循环。
      drawFrame(0);
    } else {
      startLoop();
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    setStatus('ready');

    return () => {
      stopLoop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
      const loseContext = gl.getExtension('WEBGL_lose_context');
      loseContext?.loseContext();
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  if (status === 'unsupported') return null;

  return <div ref={containerRef} className={CONTAINER_CLASSES} aria-hidden="true" />;
};

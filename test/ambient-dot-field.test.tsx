// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AmbientDotField } from '../components/AmbientDotField';

// jsdom 不提供 WebGL 与 matchMedia，统一 mock：
// - getContext 通过 spyOn(HTMLCanvasElement.prototype) 控制 WebGL 可用性与上下文对象；
// - matchMedia / requestAnimationFrame / cancelAnimationFrame 通过 vi.stubGlobal 注入；
// - 清理断言直接 spyOn window / document 的 removeEventListener 与 mock gl 的删除方法。
const createMockGL = () => {
  const loseContext = vi.fn();
  const gl = {
    VERTEX_SHADER: 'vertex-shader',
    FRAGMENT_SHADER: 'fragment-shader',
    COMPILE_STATUS: 'compile-status',
    LINK_STATUS: 'link-status',
    ARRAY_BUFFER: 'array-buffer',
    STATIC_DRAW: 'static-draw',
    TRIANGLES: 'triangles',
    FLOAT: 'float',
    createShader: vi.fn(() => ({ id: 'shader' })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: 'program' })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({ id: 'buffer' })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: 'uniform' })),
    viewport: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    drawArrays: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext })),
    loseContextRef: loseContext,
  };
  return gl as unknown as WebGLRenderingContext & {
    deleteShader: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteBuffer: ReturnType<typeof vi.fn>;
    getExtension: ReturnType<typeof vi.fn>;
    drawArrays: ReturnType<typeof vi.fn>;
    loseContextRef: ReturnType<typeof vi.fn>;
  };
};

const stubMatchMedia = (matchesReduce: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matchesReduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

// rAF mock 只登记调用不执行回调，便于精确断言「循环已启动/未启动」与取消行为。
const stubRaf = () => {
  const raf = vi.fn(() => 1);
  const caf = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  return { raf, caf };
};

describe('AmbientDotField 光场背景组件', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    delete (document as any).hidden;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WebGL 不可用时静默渲染 null 且不抛错', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<AmbientDotField />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.firstElementChild).toBeNull();
  });

  it('WebGL 可用时挂载 canvas 并启动循环；卸载时完整清理', () => {
    const gl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl);
    const { raf, caf } = stubRaf();
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');

    const { container, unmount } = render(<AmbientDotField />);
    expect(container.querySelector('canvas')).not.toBeNull();
    // 动画循环已启动
    expect(raf).toHaveBeenCalledTimes(1);

    unmount();
    // 循环取消
    expect(caf).toHaveBeenCalledWith(1);
    // window 级监听全部移除
    expect(winRemove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(winRemove).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(winRemove).toHaveBeenCalledWith('touchmove', expect.any(Function));
    // document 级可见性监听移除
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    // GL 资源删除 + 上下文丢弃
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(gl.loseContextRef).toHaveBeenCalledTimes(1);
  });

  it('prefers-reduced-motion 时不启动动画循环，仅渲染一帧静态光场', () => {
    stubMatchMedia(true);
    const gl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl);
    const { raf } = stubRaf();

    const { container } = render(<AmbientDotField />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
    // 静态帧仍然绘制（canvas 不留空白）
    expect(gl.drawArrays).toHaveBeenCalled();
  });

  it('页面隐藏时暂停 rAF 循环（document.hidden → cancel）', () => {
    const gl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl);
    const { raf, caf } = stubRaf();

    render(<AmbientDotField />);
    expect(raf).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(caf).toHaveBeenCalledWith(1);
  });
});

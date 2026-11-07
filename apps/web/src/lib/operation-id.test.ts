import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationId } from './operation-id';

describe('createOperationId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('在没有 randomUUID 的 HTTP 环境中生成不同的 UUID', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });

    const first = createOperationId();
    const second = createOperationId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});

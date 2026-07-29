const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createRequestTimingMiddleware } = require('../lib/request-timing');

function createResponse(statusCode = 200) {
    const response = new EventEmitter();
    response.statusCode = statusCode;
    return response;
}

test('慢完成请求仅记录路径、状态、耗时和完成结果', () => {
    const messages = [];
    const timestamps = [100, 1600];
    const middleware = createRequestTimingMiddleware({
        now: () => timestamps.shift(),
        warn: message => messages.push(message)
    });
    const response = createResponse(200);

    middleware({ method: 'GET', path: '/api/library/folders', originalUrl: '/api/library/folders?token=secret' }, response, () => {});
    response.emit('finish');

    assert.deepEqual(messages, [
        '[HTTP] Slow request method=GET path=/api/library/folders status=200 duration=1500ms outcome=finish'
    ]);
});

test('快速完成请求不记录日志', () => {
    const messages = [];
    const timestamps = [100, 200];
    const middleware = createRequestTimingMiddleware({
        now: () => timestamps.shift(),
        warn: message => messages.push(message)
    });
    const response = createResponse(204);

    middleware({ method: 'DELETE', path: '/api/library/file' }, response, () => {});
    response.emit('finish');

    assert.deepEqual(messages, []);
});

test('未完成的慢请求关闭时记录关闭结果', () => {
    const messages = [];
    const timestamps = [0, 1500];
    const middleware = createRequestTimingMiddleware({
        thresholdMs: 1000,
        now: () => timestamps.shift(),
        warn: message => messages.push(message)
    });
    const response = createResponse(499);

    middleware({ method: 'GET', path: '/api/library/folders' }, response, () => {});
    response.emit('close');

    assert.deepEqual(messages, [
        '[HTTP] Slow request method=GET path=/api/library/folders status=499 duration=1500ms outcome=close'
    ]);
});

test('完成后的关闭事件不会重复记录请求', () => {
    const messages = [];
    const timestamps = [0, 1500];
    const middleware = createRequestTimingMiddleware({
        thresholdMs: 1000,
        now: () => timestamps.shift(),
        warn: message => messages.push(message)
    });
    const response = createResponse(200);

    middleware({ method: 'GET', path: '/api/library/folders' }, response, () => {});
    response.emit('finish');
    response.emit('close');

    assert.deepEqual(messages, [
        '[HTTP] Slow request method=GET path=/api/library/folders status=200 duration=1500ms outcome=finish'
    ]);
});

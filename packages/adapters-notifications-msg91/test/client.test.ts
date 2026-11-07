import { afterEach, describe, expect, it, vi } from 'vitest';

import { Msg91HttpClient } from '../src/client.js';

const url = 'https://control.msg91.com/api/v5/flow';

const answering = (status: number, body: string) =>
	new Msg91HttpClient({ authKey: 'test-key', fetchImpl: async () => new Response(body, { status }) });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Msg91HttpClient', () => {
	it('uses the global fetch and sends the auth key as a header', async () => {
		const fetchSpy = vi.fn(async () => new Response('{"request_id":"r1"}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const result = await new Msg91HttpClient({ authKey: 'test-key' }).postJson(url, { a: 1 });
		expect(result).toEqual({ ok: true, providerMessageId: 'r1', errorMessage: null, httpStatus: 200 });
		const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect((init.headers as Record<string, string>)['authkey']).toBe('test-key');
		expect(init.body).toBe('{"a":1}');
	});

	it.each(['requestId', 'message_id', 'messageId', 'id'])('reads the provider id from %s', async (key) => {
		const result = await answering(200, JSON.stringify({ [key]: 'p1' })).postJson(url, {});
		expect(result.providerMessageId).toBe('p1');
	});

	it('reads a provider id nested under data', async () => {
		const result = await answering(200, '{"data":{"id":"nested"}}').postJson(url, {});
		expect(result.providerMessageId).toBe('nested');
	});

	it('skips an empty id and a data field that is not an object', async () => {
		expect((await answering(200, '{"id":"","data":"queued"}').postJson(url, {})).providerMessageId).toBeNull();
		expect((await answering(200, '{"id":7}').postJson(url, {})).providerMessageId).toBeNull();
	});

	it('accepts an empty reply and a reply that is not an object', async () => {
		expect(await answering(200, '').postJson(url, {})).toMatchObject({ ok: true, providerMessageId: null });
		expect(await answering(200, '"ok"').postJson(url, {})).toMatchObject({ ok: true, providerMessageId: null });
	});

	it('survives a reply that is not JSON', async () => {
		const result = await answering(200, '<html>accepted</html>').postJson(url, {});
		expect(result).toMatchObject({ ok: true, providerMessageId: null });
	});

	it.each([
		['message', '{"message":"bad flow"}', 'MSG91 HTTP 400: bad flow'],
		['error', '{"error":"no credit"}', 'MSG91 HTTP 400: no credit'],
		['type', '{"type":"error"}', 'MSG91 HTTP 400: error'],
		['an empty message', '{"message":""}', 'MSG91 HTTP 400'],
		['a message that is not text', '{"message":{"a":1}}', 'MSG91 HTTP 400'],
		['a reply that is not an object', '"nope"', 'MSG91 HTTP 400'],
		['no reply', '', 'MSG91 HTTP 400'],
	])('summarises a refusal with %s', async (_label, body, expected) => {
		const result = await answering(400, body).postJson(url, {});
		expect(result).toMatchObject({ ok: false, errorMessage: expected, httpStatus: 400 });
	});

	it('cuts a long provider message', async () => {
		const result = await answering(400, JSON.stringify({ message: 'x'.repeat(500) })).postJson(url, {});
		expect(result.errorMessage).toHaveLength('MSG91 HTTP 400: '.length + 200);
	});

	it('turns a network error into a failed result', async () => {
		const client = new Msg91HttpClient({
			authKey: 'test-key',
			fetchImpl: async () => {
				throw new Error('socket hang up');
			},
		});
		expect(await client.postJson(url, {})).toEqual({
			ok: false,
			providerMessageId: null,
			errorMessage: 'socket hang up',
			httpStatus: 0,
		});
	});

	it('handles a failure that is not an Error', async () => {
		const client = new Msg91HttpClient({
			authKey: 'test-key',
			fetchImpl: async () => {
				throw 'offline';
			},
		});
		expect((await client.postJson(url, {})).errorMessage).toBe('MSG91 request failed');
	});

	it('aborts a request that runs past the timeout', async () => {
		vi.useFakeTimers();
		const client = new Msg91HttpClient({
			authKey: 'test-key',
			timeoutMs: 50,
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				}),
		});
		const pending = client.postJson(url, {});
		await vi.advanceTimersByTimeAsync(50);
		expect((await pending).errorMessage).toBe('aborted');
	});
});

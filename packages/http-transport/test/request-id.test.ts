import { describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER, readRequestId } from '../src/request-id.js';

const from = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

describe('readRequestId', () => {
	it('reads the id the API echoes on every response', () => {
		expect(readRequestId(from({ [REQUEST_ID_HEADER]: 'req_9f2c' }))).toBe('req_9f2c');
	});

	it('trims surrounding whitespace', () => {
		expect(readRequestId(from({ [REQUEST_ID_HEADER]: '  req_9f2c  ' }))).toBe('req_9f2c');
	});

	it.each([
		['a missing header', {}],
		['an empty value', { [REQUEST_ID_HEADER]: '' }],
		['a whitespace-only value', { [REQUEST_ID_HEADER]: '   ' }],
	])('returns null for %s', (_label, headers) => {
		expect(readRequestId(from(headers))).toBeNull();
	});

	it('returns null when the accessor yields a non-string', () => {
		expect(readRequestId(() => undefined)).toBeNull();
		expect(readRequestId(() => null)).toBeNull();
	});

	// The value is read off the wire. An id carrying CR/LF would inject lines into any
	// client-side log or error report that includes it.
	it.each([
		['a newline', 'req_1\nInjected: true'],
		['a carriage return', 'req_1\r\nSet-Cookie: x=y'],
		['an inner space', 'req 1'],
		['a tab', 'req\t1'],
		['a NUL', `req${String.fromCharCode(0)}1`],
		['a DEL', `req${String.fromCharCode(127)}1`],
		['a non-ASCII character', 'req_é'],
	])('rejects an id containing %s', (_label, value) => {
		expect(readRequestId(from({ [REQUEST_ID_HEADER]: value }))).toBeNull();
	});

	it('rejects an oversized id', () => {
		expect(readRequestId(from({ [REQUEST_ID_HEADER]: 'a'.repeat(129) }))).toBeNull();
		expect(readRequestId(from({ [REQUEST_ID_HEADER]: 'a'.repeat(128) }))).toBe('a'.repeat(128));
	});
});

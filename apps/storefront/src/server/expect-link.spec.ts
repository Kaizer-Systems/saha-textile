import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { type H3Event, createEvent } from 'h3';
import { describe, expect, it } from 'vitest';

import { anchorExpectLink } from './expect-link';
import expectLink from './plugins/expect-link';

const PAGE = '<head><link rel="expect" href="#page-content" blocking="render"></head><body></body>';

describe('anchorExpectLink', () => {
	it("names the page's own address, so the shop's base href cannot point it at the home page", () => {
		expect(anchorExpectLink(PAGE, '/bn/')).toContain(
			'<link rel="expect" href="/bn/#page-content" blocking="render">',
		);
	});

	it('keeps the query, escaped for the attribute, and a $ as written', () => {
		expect(anchorExpectLink(PAGE, '/en/collections/sarees?page=2&sort=$new"<')).toContain(
			'href="/en/collections/sarees?page=2&amp;sort=$new&quot;&lt;#page-content"',
		);
	});

	it('leaves a page without the link as it is', () => {
		expect(anchorExpectLink('<p>#page-content</p>', '/en/')).toBe('<p>#page-content</p>');
	});
});

describe('the expect-link server plugin', () => {
	const answer = (path: string, status: number, body: unknown) => {
		let handler: ((event: H3Event, response: { body?: unknown }) => void) | undefined;
		expectLink({ hooks: { hook: (_name, fn) => (handler = fn) } });
		const request = new IncomingMessage(new Socket());
		request.url = path;
		request.method = 'GET';
		request.headers.host = 'shop.test';
		const response = new ServerResponse(request);
		response.statusCode = status;
		const sent = { body };
		handler?.(createEvent(request, response), sent);
		return sent.body;
	};

	it('gives each page drawn as asked its own address', () => {
		expect(answer('/bn/collections/sarees?page=2', 200, PAGE)).toContain(
			'href="/bn/collections/sarees?page=2#page-content"',
		);
	});

	it('leaves other answers alone: another status, or a body that is not text', () => {
		expect(answer('/bn/old-page', 410, PAGE)).toBe(PAGE);
		const stream = { pipe: true };
		expect(answer('/bn/', 200, stream)).toBe(stream);
	});
});

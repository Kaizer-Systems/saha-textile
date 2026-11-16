import { describe, expect, it } from 'vitest';

import { ChromiumDocumentRenderer } from '../src/chromium-document-renderer';

/**
 * Renders a real document with a real browser. Needs a Chromium: the installed Chrome locally
 * (`PDF_CHROMIUM_CHANNEL=chrome`) or Playwright's headless shell in the server image.
 *
 *   RUN_PDF_IT=1 PDF_CHROMIUM_CHANNEL=chrome pnpm --filter @saha-textile/adapters-pdf-chromium test
 */
const enabled = process.env.RUN_PDF_IT === '1';

describe.skipIf(!enabled)('Chromium document renderer (real browser)', () => {
	const renderer = new ChromiumDocumentRenderer({
		channel: process.env.PDF_CHROMIUM_CHANNEL || undefined,
		executablePath: process.env.PDF_CHROMIUM_EXECUTABLE || undefined,
		timeoutMs: 20_000,
		idleCloseMs: 1_000,
		concurrency: 2,
	});
	const page = { size: 'A4' as const, landscape: false, marginMm: { top: 10, right: 10, bottom: 10, left: 10 } };

	it('makes a PDF from HTML and its own stylesheet, with Bengali text', async () => {
		const pdf = await renderer.renderPdf({
			html: '<!doctype html><html><head><meta charset="utf-8"><title>Test</title><link rel="stylesheet" href="doc.css"></head><body><h1>Purchase order</h1><p>শ্রী সাহা টেক্সটাইল ₹1,83,750</p></body></html>',
			assets: [{ path: 'doc.css', contentType: 'text/css', data: new TextEncoder().encode('h1{color:#0da487}') }],
			title: 'Test',
			author: 'Saha Textile',
			page,
		});
		expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
		expect(pdf.length).toBeGreaterThan(1_000);
	}, 60_000);

	it('never reaches the network: an outside picture is refused, the document still renders', async () => {
		const pdf = await renderer.renderPdf({
			html: '<!doctype html><html><body><img src="https://example.com/x.png"><img src="file:///etc/passwd"><p>Still here</p></body></html>',
			assets: [],
			title: 'Blocked',
			author: 'Saha Textile',
			page,
		});
		expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
		await renderer.close();
	}, 60_000);
});

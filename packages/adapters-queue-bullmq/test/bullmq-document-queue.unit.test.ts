import type { DocumentRenderRequest } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BullMqDocumentRenderer, DOCUMENT_QUEUE_NAME, startDocumentWorker } from '../src/bullmq-document-queue.js';

const queue = vi.hoisted(() => {
	const waitUntilFinished = vi.fn(async () => ({ pdf: 'AQID' }));
	return {
		opened: vi.fn(),
		eventsOpened: vi.fn(),
		workerStarted: vi.fn(),
		waitUntilReady: vi.fn(async () => undefined),
		waitUntilFinished,
		add: vi.fn(async () => ({ waitUntilFinished })),
		close: vi.fn(async () => undefined),
		eventsClose: vi.fn(async () => undefined),
	};
});

vi.mock('bullmq', () => ({
	Queue: class {
		add = queue.add;
		close = queue.close;
		constructor(...args: unknown[]) {
			queue.opened(...args);
		}
	},
	QueueEvents: class {
		waitUntilReady = queue.waitUntilReady;
		close = queue.eventsClose;
		constructor(...args: unknown[]) {
			queue.eventsOpened(...args);
		}
	},
	Worker: class {
		constructor(...args: unknown[]) {
			queue.workerStarted(...args);
		}
	},
}));

const redis = { host: '127.0.0.1', port: 6379, db: 3 };
const request: DocumentRenderRequest = {
	html: '<p>Receipt</p>',
	assets: [{ path: 'image.png', contentType: 'image/png', data: Uint8Array.of(4, 5) }],
	title: 'Receipt',
	author: 'Saha Textile',
	page: { size: 'A4', landscape: false, marginMm: { top: 10, right: 10, bottom: 10, left: 10 } },
};
const serialized = { ...request, assets: [{ ...request.assets[0], data: 'BAU=' }] };

beforeEach(() => vi.clearAllMocks());

describe('BullMqDocumentRenderer', () => {
	it('opens no Redis connections before submitting a render', async () => {
		await new BullMqDocumentRenderer(redis).close();
		expect(queue.opened).not.toHaveBeenCalled();
		expect(queue.eventsOpened).not.toHaveBeenCalled();
		expect(queue.close).not.toHaveBeenCalled();
		expect(queue.eventsClose).not.toHaveBeenCalled();
	});

	it('reuses its connection, waits for the right job, and returns the PDF bytes', async () => {
		const renderer = new BullMqDocumentRenderer({ ...redis, password: 'test-redis-value' }, 750);
		for (let render = 0; render < 2; render += 1) {
			await expect(renderer.renderPdf(request)).resolves.toEqual(Uint8Array.of(1, 2, 3));
		}
		expect(queue.opened).toHaveBeenCalledExactlyOnceWith(
			DOCUMENT_QUEUE_NAME,
			expect.objectContaining({
				connection: { ...redis, password: 'test-redis-value', maxRetriesPerRequest: null },
				defaultJobOptions: { attempts: 1, removeOnComplete: { age: 60 }, removeOnFail: { age: 86_400 } },
			}),
		);
		expect(queue.eventsOpened).toHaveBeenCalledTimes(1);
		expect(queue.waitUntilReady).toHaveBeenCalledBefore(queue.add);
		expect(queue.add).toHaveBeenCalledWith('render-pdf', serialized);
		expect(queue.waitUntilFinished).toHaveBeenCalledWith(
			expect.objectContaining({ close: queue.eventsClose }),
			750,
		);
		await renderer.close();
		expect(queue.close).toHaveBeenCalledTimes(1);
		expect(queue.eventsClose).toHaveBeenCalledTimes(1);
	});

	it('reports a worker timeout to the caller', async () => {
		const timeout = new Error('render timed out');
		queue.waitUntilFinished.mockRejectedValueOnce(timeout);
		await expect(new BullMqDocumentRenderer(redis).renderPdf(request)).rejects.toBe(timeout);
		expect(queue.waitUntilFinished).toHaveBeenCalledWith(expect.anything(), 45_000);
	});
});

it('decodes the queued asset bytes before rendering and encodes the resulting PDF', async () => {
	const renderPdf = vi.fn(async (_document: DocumentRenderRequest) => Uint8Array.of(1, 2, 3));
	startDocumentWorker(redis, { renderPdf });
	expect(queue.workerStarted).toHaveBeenCalledExactlyOnceWith(
		DOCUMENT_QUEUE_NAME,
		expect.any(Function),
		expect.objectContaining({ concurrency: 2, connection: { ...redis, maxRetriesPerRequest: null } }),
	);
	const process = queue.workerStarted.mock.calls[0]?.[1] as (job: { data: typeof serialized }) => Promise<unknown>;
	await expect(process({ data: serialized })).resolves.toEqual({ pdf: 'AQID' });
	expect(renderPdf).toHaveBeenCalledExactlyOnceWith(request);
});

it('carries a page foot (page x of y, an e-invoice band) to the worker and back to the renderer', async () => {
	const footed = { ...request, footerHtml: '<div>Page <span class="pageNumber"></span></div>' };
	await new BullMqDocumentRenderer(redis).renderPdf(footed);
	expect(queue.add).toHaveBeenLastCalledWith(
		'render-pdf',
		expect.objectContaining({ footerHtml: footed.footerHtml }),
	);
	const renderPdf = vi.fn(async (_document: DocumentRenderRequest) => Uint8Array.of(1, 2, 3));
	startDocumentWorker(redis, { renderPdf });
	const process = queue.workerStarted.mock.calls.at(-1)?.[1] as (job: { data: unknown }) => Promise<unknown>;
	await process({ data: { ...serialized, footerHtml: footed.footerHtml } });
	expect(renderPdf).toHaveBeenCalledExactlyOnceWith(footed);
});

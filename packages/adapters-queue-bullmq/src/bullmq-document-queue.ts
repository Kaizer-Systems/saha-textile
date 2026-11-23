import type { DocumentRenderRequest, DocumentRendererPort } from '@saha-textile/core-domain';
import { type Job, Queue, QueueEvents, Worker } from 'bullmq';

import { queueTelemetry } from './telemetry';

import type { RedisConnectionConfig } from './bullmq-media-queue.js';

/**
 * Business documents are drawn in the background worker (owner decision 2026-11-17), so the
 * browser never runs inside the API process: the API asks, waits for the PDF, and answers. One
 * queue of its own, so a burst of photo work never makes a staff member wait for a PDF.
 */
export const DOCUMENT_QUEUE_NAME = 'saha-textile-documents';

interface RenderJobData {
	html: string;
	/** File bytes travel as base64: BullMQ stores job data as JSON in Redis. */
	assets: Array<{ path: string; contentType: string; data: string }>;
	title: string;
	author: string;
	page: DocumentRenderRequest['page'];
}

interface RenderJobResult {
	pdf: string;
}

const connectionOptions = (config: RedisConnectionConfig) => ({
	host: config.host,
	port: config.port,
	db: config.db,
	...(config.password ? { password: config.password } : {}),
	maxRetriesPerRequest: null,
});

/**
 * Nobody waits twice: a render is tried once (the person can press again), and its PDF is kept
 * only a minute, long enough for the API to read it back. Failures stay a day for debugging.
 */
const JOB_OPTIONS = {
	attempts: 1,
	removeOnComplete: { age: 60 },
	removeOnFail: { age: 86_400 },
} as const;

/** The API side: hands a document to the worker and waits for its PDF. */
export class BullMqDocumentRenderer implements DocumentRendererPort {
	private queue: Queue<RenderJobData, RenderJobResult> | null = null;
	private events: QueueEvents | null = null;

	constructor(
		private readonly config: RedisConnectionConfig,
		private readonly waitMs = 45_000,
	) {}

	/** Connects on first use, so an API that never makes a PDF never opens these connections. */
	private connect(): { queue: Queue<RenderJobData, RenderJobResult>; events: QueueEvents } {
		this.queue ??= new Queue<RenderJobData, RenderJobResult>(DOCUMENT_QUEUE_NAME, {
			connection: connectionOptions(this.config),
			defaultJobOptions: JOB_OPTIONS,
			telemetry: queueTelemetry,
		});
		this.events ??= new QueueEvents(DOCUMENT_QUEUE_NAME, { connection: connectionOptions(this.config) });
		return { queue: this.queue, events: this.events };
	}

	async renderPdf(request: DocumentRenderRequest): Promise<Uint8Array> {
		const { queue, events } = this.connect();
		await events.waitUntilReady();
		const job = await queue.add('render-pdf', {
			html: request.html,
			assets: request.assets.map((asset) => ({
				path: asset.path,
				contentType: asset.contentType,
				data: Buffer.from(asset.data).toString('base64'),
			})),
			title: request.title,
			author: request.author,
			page: request.page,
		});
		const result = (await job.waitUntilFinished(events, this.waitMs)) as RenderJobResult;
		return new Uint8Array(Buffer.from(result.pdf, 'base64'));
	}

	async close(): Promise<void> {
		await Promise.all([this.events?.close(), this.queue?.close()]);
	}
}

/** The worker side: draws each document with the renderer it is given (Chromium in the image). */
export function startDocumentWorker(
	config: RedisConnectionConfig,
	renderer: DocumentRendererPort,
	concurrency = 2,
): Worker<RenderJobData, RenderJobResult> {
	return new Worker<RenderJobData, RenderJobResult>(
		DOCUMENT_QUEUE_NAME,
		async (job: Job<RenderJobData, RenderJobResult>) => {
			const pdf = await renderer.renderPdf({
				html: job.data.html,
				assets: job.data.assets.map((asset) => ({
					path: asset.path,
					contentType: asset.contentType,
					data: new Uint8Array(Buffer.from(asset.data, 'base64')),
				})),
				title: job.data.title,
				author: job.data.author,
				page: job.data.page,
			});
			return { pdf: Buffer.from(pdf).toString('base64') };
		},
		{ connection: connectionOptions(config), concurrency, telemetry: queueTelemetry },
	);
}

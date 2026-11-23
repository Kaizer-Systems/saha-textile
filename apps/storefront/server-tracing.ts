/**
 * Request tracing for the shop's server pages (owner, 2026-11-23, Release Path brief Q7), loaded before
 * the server with `node --import ./tracing.mjs server/index.mjs`. Built into dist/analog/tracing.mjs by
 * server-tracing.vite.ts, with its packages bundled in, because the server image carries no node_modules.
 *
 * On only when OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set; otherwise nothing is sent. Traces the page
 * request and its calls to the API (the trace id travels with them, so the API's spans join it), with
 * addresses masked by the same rule as the API's logs and the edge.
 */
import { createRequire } from 'node:module';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type ReadableSpan, type Span, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// One masking rule for logs, the edge and traces: bundled from the API's source at build time.
import { maskAddress } from '../api/src/infra/log-masking';

const ADDRESSES = ['url.full', 'url.path', 'url.query', 'http.target', 'http.url'];

/** Masks one-time tokens in addresses the moment a span starts. */
export class AddressMaskingProcessor implements SpanProcessor {
	onStart(span: Span): void {
		const { attributes } = span as unknown as ReadableSpan;
		for (const name of ADDRESSES) {
			const value = attributes[name];
			if (typeof value === 'string') span.setAttribute(name, maskAddress(value));
		}
	}
	onEnd(): void {}
	forceFlush(): Promise<void> {
		return Promise.resolve();
	}
	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

/** Starts tracing when the endpoint is set; returns the provider, or null. */
export function startShopTracing(env: NodeJS.ProcessEnv = process.env): NodeTracerProvider | null {
	const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
	if (!url) return null;
	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: 'saha-textile-storefront',
			'deployment.environment.name': env.DEPLOY_ENV || 'local',
		}),
		spanProcessors: [new AddressMaskingProcessor(), new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
	});
	provider.register();
	registerInstrumentations({
		tracerProvider: provider,
		instrumentations: [
			new HttpInstrumentation({
				ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') ?? false,
			}),
			new UndiciInstrumentation(),
		],
	});
	// The server is an ES module, so the instrumentation's require hook never sees it load node:http.
	// Requiring the core modules here patches the one shared module object it then uses.
	const require = createRequire(import.meta.url);
	require('node:http');
	require('node:https');
	return provider;
}

startShopTracing();

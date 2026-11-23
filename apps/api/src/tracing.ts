import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type ReadableSpan, type Span, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { maskAddress } from './infra/log-masking';

/** The span attributes that hold an address, masked before a span is kept. */
export const TRACED_ADDRESSES = ['url.full', 'url.path', 'url.query', 'http.target', 'http.url'] as const;

/**
 * Masks one-time tokens, codes and keys in addresses with the same placeholders as the logs
 * (`/en/pay/{{token}}`, `?token={{token}}`), the moment a span starts.
 */
export class AddressMaskingProcessor implements SpanProcessor {
	onStart(span: Span): void {
		const { attributes } = span as unknown as ReadableSpan;
		for (const name of TRACED_ADDRESSES) {
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

/**
 * Request tracing (owner, 2026-11-23, Release Path brief Q7): on only when
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` names the trace store (VictoriaTraces in the local stack's
 * `tracing` profile); otherwise nothing loads and nothing is sent. Incoming and outgoing requests,
 * MongoDB and Redis are traced. Database calls show only their shape (every value is `?`), Redis
 * calls only the command, never its arguments, and addresses are masked as in the logs. Must start
 * before the app's own modules load, so each entry point imports a start file first.
 */
export function startTracing(service: string, env: NodeJS.ProcessEnv = process.env): NodeTracerProvider | null {
	const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
	if (!url) return null;
	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: service,
			'deployment.environment.name': env.DEPLOY_ENV || 'local',
		}),
		spanProcessors: [new AddressMaskingProcessor(), new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
	});
	provider.register();
	registerInstrumentations({
		tracerProvider: provider,
		instrumentations: [
			// Health probes every few seconds would bury the requests worth reading.
			new HttpInstrumentation({
				ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') ?? false,
			}),
			new UndiciInstrumentation(),
			new MongoDBInstrumentation({ enhancedDatabaseReporting: false }),
			new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
		],
	});
	return provider;
}

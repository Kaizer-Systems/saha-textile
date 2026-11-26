import { describe, expect, it, vi } from 'vitest';

/** Every OpenTelemetry part is replaced: nothing is registered or sent from a test. */
const made = vi.hoisted(() => ({
	providers: [] as Array<{ options: { resource: Record<string, unknown> }; register: ReturnType<typeof vi.fn> }>,
	http: [] as Array<{ ignoreIncomingRequestHook(request: { url?: string }): boolean }>,
	redis: [] as Array<{ dbStatementSerializer(command: string): string }>,
	registered: [] as unknown[],
}));
vi.mock('@opentelemetry/sdk-trace-node', () => ({
	NodeTracerProvider: class {
		register = vi.fn();
		constructor(public options: { resource: Record<string, unknown> }) {
			made.providers.push(this);
		}
	},
}));
vi.mock('@opentelemetry/instrumentation', () => ({
	registerInstrumentations: (options: unknown) => made.registered.push(options),
}));
vi.mock('@opentelemetry/instrumentation-http', () => ({
	HttpInstrumentation: class {
		constructor(config: { ignoreIncomingRequestHook(request: { url?: string }): boolean }) {
			made.http.push(config);
		}
	},
}));
vi.mock('@opentelemetry/instrumentation-ioredis', () => ({
	IORedisInstrumentation: class {
		constructor(config: { dbStatementSerializer(command: string): string }) {
			made.redis.push(config);
		}
	},
}));
vi.mock('@opentelemetry/instrumentation-mongodb', () => ({ MongoDBInstrumentation: class {} }));
vi.mock('@opentelemetry/instrumentation-undici', () => ({ UndiciInstrumentation: class {} }));
vi.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({ OTLPTraceExporter: class {} }));
vi.mock('@opentelemetry/resources', () => ({
	resourceFromAttributes: (attributes: Record<string, unknown>) => attributes,
}));

import { startTracing } from '../src/tracing';

describe('tracing on', () => {
	it('names the environment, or local without one, and registers the provider once', () => {
		const url = 'http://traces.test:4318/v1/traces';
		expect(startTracing('saha-textile-api', { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: url })).not.toBeNull();
		startTracing('saha-textile-worker', { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: url, DEPLOY_ENV: 'staging' });
		expect(made.providers.map((provider) => provider.options.resource['deployment.environment.name'])).toEqual([
			'local',
			'staging',
		]);
		expect(made.providers[0]?.register).toHaveBeenCalledTimes(1);
		expect(made.registered).toHaveLength(2);
	});

	it('leaves health probes out, keeps every other request, and keeps only the Redis command', () => {
		const [http] = made.http;
		expect(http?.ignoreIncomingRequestHook({ url: '/health/live' })).toBe(true);
		expect(http?.ignoreIncomingRequestHook({ url: '/en/products' })).toBe(false);
		expect(http?.ignoreIncomingRequestHook({})).toBe(false);
		expect(made.redis[0]?.dbStatementSerializer('get')).toBe('get');
	});
});

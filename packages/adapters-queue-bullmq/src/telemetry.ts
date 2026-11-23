import { BullMQOtel } from 'bullmq-otel';

/**
 * Carries a request's trace into the jobs it queues, so the worker's span joins the same trace
 * (Release Path brief Q7). It uses the process's tracer: a no-op unless the API or worker started
 * tracing (OTEL_EXPORTER_OTLP_TRACES_ENDPOINT), so nothing is recorded or sent otherwise.
 */
export const queueTelemetry = new BullMQOtel({ tracerName: 'saha-textile-queues' });

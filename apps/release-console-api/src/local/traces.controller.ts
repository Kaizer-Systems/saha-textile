import { Controller, Get, Param, Query } from '@nestjs/common';
import {
	type TraceView,
	type TracesList,
	type TracingView,
	diagnose,
	edgesOf,
	traceOf,
	tracingRawSchema,
	tracingView,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { parseBody } from '../common/parse.js';
import { HelperError, RunnerClient } from '../runner/runner-client.js';

/** The shop's own services in the traces (the Infisical chat's M7). */
const OURS = ['saha-textile-storefront', 'saha-textile-api', 'saha-textile-worker'];

type Answer = { off?: boolean; message?: string; data?: unknown };

/**
 * Watch › Traces on this computer (Release Path brief Part 6, Q7 approved 23 Nov: local now, servers
 * after DEC-TRACING-SERVERS): the slowest and the failed requests, one request's waterfall with the
 * rule-based Diagnose, and the service map, from the local VictoriaTraces through the Mac helper.
 */
@Controller('api/local/traces')
export class TracesController {
	private readonly helper = new RunnerClient();

	private read(kind: string, q: Record<string, string> = {}): Promise<Answer> {
		return this.helper.call<Answer>(
			'GET',
			`/traces/${kind}?${new URLSearchParams(q).toString()}`,
			undefined,
			20_000,
		);
	}

	private async recent(errors: boolean, services: string[]): Promise<TraceView[]> {
		const seen = new Map<string, TraceView>();
		for (const service of services) {
			const a = await this.read('search', { service, limit: '40', lookback: '1h', errors: errors ? '1' : '0' });
			for (const raw of Array.isArray(a.data) ? a.data : []) {
				const t = traceOf(raw);
				if (t && !seen.has(t.id)) seen.set(t.id, t);
			}
		}
		return [...seen.values()];
	}

	@Get()
	async list(@Query() query: unknown): Promise<TracesList> {
		const { view } = parseBody(z.object({ view: z.enum(['slowest', 'errors']).default('slowest') }), query);
		const s = await this.read('services');
		if (s.off) return { state: 'off', message: s.message ?? '', services: [], traces: [], edges: [] };
		const services = (Array.isArray(s.data) ? s.data : []).filter((x): x is string => typeof x === 'string');
		const mine = services.filter((x) => OURS.includes(x));
		const traces = await this.recent(view === 'errors', mine.length ? mine : services.slice(0, 5));
		const list = (view === 'errors' ? traces.filter((t) => t.error) : traces)
			.sort((a, b) => (view === 'errors' ? b.at.localeCompare(a.at) : b.ms - a.ms))
			.slice(0, 50);
		return {
			state: 'ok',
			message: `${traces.length} traces in the last hour`,
			services,
			traces: list.map(({ spans, diagnose: _d, ...t }) => ({ ...t, spans: spans.length })),
			edges: edgesOf(traces),
		};
	}

	@Get(':id')
	async one(@Param('id') id: string): Promise<TraceView> {
		if (!/^[0-9a-f]{8,32}$/i.test(id)) throw new HelperError('Not a trace id.', 400);
		const a = await this.read('trace', { id });
		if (a.off) throw new HelperError(a.message ?? 'VictoriaTraces is not answering.', 503);
		const t = traceOf(Array.isArray(a.data) ? a.data[0] : null);
		if (!t) throw new HelperError('No trace with that id in the last 7 days.', 404);
		const others = await this.recent(false, [t.service]).catch(() => []);
		return {
			...t,
			diagnose: diagnose(
				t,
				others.filter((o) => o.id !== t.id),
			),
		};
	}
}

/**
 * The tracing switch's state on this Mac (brief 8UmNaHHAuiGLez47McHkj8, approved 23 Nov): the helper's
 * read of Docker, the store, the address and what runs, plus each app's traces in the last hour.
 * Turning it on or off is the local run actions `tracing-on` and `tracing-off`, with the PIN.
 */
@Controller('api/local/tracing')
export class TracingController {
	private readonly helper = new RunnerClient();

	@Get()
	async read(): Promise<TracingView> {
		const parsed = tracingRawSchema.safeParse(
			await this.helper.call<unknown>('GET', '/tracing/state', undefined, 30_000),
		);
		if (!parsed.success)
			throw new HelperError('The Mac helper answered in a shape the console does not know.', 502);
		const counts: Record<string, number> = {};
		if (parsed.data.store)
			for (const service of ['saha-textile-api', 'saha-textile-worker', 'saha-textile-storefront']) {
				const a = await this.helper
					.call<Answer>(
						'GET',
						`/traces/search?${new URLSearchParams({ service, limit: '100', lookback: '1h' })}`,
						undefined,
						20_000,
					)
					.catch(() => ({}) as Answer);
				counts[service] = Array.isArray(a.data) ? a.data.length : 0;
			}
		return tracingView(parsed.data, counts);
	}
}

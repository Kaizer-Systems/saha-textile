import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { ProductFormPart, ProductJobPart, ProductJobsPart, ProductMonitorPart, ProductViewPart } from './product-parts';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type {
	ProductField,
	ProductFieldValue,
	ProductForm,
	ProductJob,
	ProductRow,
	ProductTable,
	Tone,
} from '@saha-textile/release-console-contracts';

/** The parts' members these tests use (protected on the components). */
interface View {
	pill(t: Tone): string;
	dotOf(t: Tone): string;
	openRow(t: ProductTable, r: ProductRow): void;
}
interface Chart {
	name: string;
	colour: string;
	last: number | string;
	min: number | string;
	max: number | string;
	from: string;
	to: string;
}
interface Form {
	values: () => Record<string, ProductFieldValue | null>;
	confirming: { set(v: boolean): void; (): boolean };
	typed: { set(v: string): void };
	pin: { set(v: string): void };
	busy: () => boolean;
	error: () => string;
	job: () => ProductJob | null;
	set(key: string, v: ProductFieldValue): void;
	has(key: string, v: string): boolean;
	flip(key: string, v: string): void;
	send(): Promise<void>;
}

const job = (state: ProductJob['state'], id = 'job_1', steps: ProductJob['steps'] = []): ProductJob => ({
	id,
	screen: 'droplets',
	form: 'create',
	target: 'web-1',
	startedAt: '2026-11-24T04:00:00.000Z',
	finishedAt: null,
	state,
	message: '',
	productId: null,
	steps,
});
const field = (key: string, type: ProductField['type'], value: ProductFieldValue | null): ProductField => ({
	key,
	label: key,
	type,
	options: [],
	value,
	help: '',
	required: false,
	min: null,
	max: null,
	readOnly: false,
});
const FORM: ProductForm = {
	key: 'create',
	title: 'Create a droplet',
	submit: 'Create',
	fields: [
		field('name', 'text', 'web-1'),
		field('tags', 'multi', ['a']),
		field('token', 'secret', 'xyz'),
		field('size', 'select', null),
	],
	cost: null,
	notes: [],
	confirmName: null,
	danger: false,
	blocked: null,
};

let client: QueryClient;
function setUp(api: Record<string, unknown>, ids = true) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(client),
			{ provide: ConsoleApi, useValue: api },
			{
				provide: ConsoleContext,
				useValue: { projectId: () => (ids ? 'proj_1' : null), repoId: () => (ids ? 'shop' : null) },
			},
		],
	});
}

describe('the product view', () => {
	it('names every tone as a pill and a dot, and opens only rows that open something', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(ProductViewPart, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductViewPart);
		fixture.componentRef.setInput('view', {
			head: null,
			stats: [],
			notes: [],
			facts: [],
			tables: [],
			links: [],
			actions: [],
		});
		fixture.detectChanges();
		const c = fixture.componentInstance as unknown as View;
		const tones: Tone[] = ['ok', 'red', 'amber', 'muted', 'cy', null];
		expect(tones.map((t) => c.pill(t))).toEqual(['ok', 'red', 'amber', 'muted', 'cy', '']);
		expect(tones.map((t) => c.dotOf(t))).toEqual(['ok', 'red', 'amber', '', 'cy', 'cy']);
		const opened = vi.fn();
		fixture.componentInstance.open.subscribe(opened);
		const row: ProductRow = { id: 'd1', name: 'web-1', cells: {}, tone: null };
		const table = (opens: boolean): ProductTable => ({ title: '', columns: [], rows: [], empty: '', opens });
		c.openRow(table(false), row);
		c.openRow(table(true), { ...row, id: '' });
		c.openRow(table(true), row);
		expect(opened).toHaveBeenCalledTimes(1);
	});
});

describe('the product monitor', () => {
	it('draws each measure with its colour, now, low and high, and a measure with no points', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(ProductMonitorPart, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductMonitorPart);
		const series = Array.from({ length: 7 }, (_, i) => ({
			name: `m${i}`,
			unit: '%',
			points: [
				[1_700_000_000, 12.345],
				[1_700_000_060, 250.6],
			] as Array<[number, number]>,
		}));
		series.push({ name: 'empty', unit: '', points: [] });
		fixture.componentRef.setInput('monitor', { series, notes: [] });
		fixture.detectChanges();
		const charts = (fixture.componentInstance as unknown as { charts: () => Chart[] }).charts();
		expect(charts[0]).toMatchObject({ last: 251, min: 12.3, max: 251 });
		expect(charts[6]?.colour).toBe(charts[0]?.colour);
		expect(charts[0]?.from).not.toBe('');
		expect(charts[7]).toMatchObject({ last: '—', min: '—', max: '—', from: '', to: '' });
	});
});

describe('a followed change', () => {
	it('shows how far its steps have come, and nothing for a change without steps', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(ProductJobPart, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductJobPart);
		const pct = () => (fixture.componentInstance as unknown as { pct: () => number }).pct();
		fixture.componentRef.setInput('job', job('running'));
		fixture.detectChanges();
		expect(pct()).toBe(0);
		fixture.componentRef.setInput(
			'job',
			job('running', 'job_1', [
				{ label: 'a', detail: '', state: 'done' },
				{ label: 'b', detail: '', state: 'running' },
			]),
		);
		expect(pct()).toBe(50);
	});
});

describe('the changes sent from a screen', () => {
	it('reads them again every two seconds while one is running', async () => {
		const productJobs = vi.fn(async () => [job('running')]);
		setUp({ productJobs });
		TestBed.overrideComponent(ProductJobsPart, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductJobsPart);
		fixture.componentRef.setInput('screen', 'droplets');
		fixture.detectChanges();
		await vi.waitFor(() => expect(productJobs.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });
		productJobs.mockResolvedValue([job('done')]);
		fixture.destroy();
	});
});

describe('a product form', () => {
	function make(api: Record<string, unknown>, ids = true) {
		setUp(api, ids);
		TestBed.overrideComponent(ProductFormPart, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductFormPart);
		fixture.componentRef.setInput('screen', 'droplets');
		fixture.componentRef.setInput('form', FORM);
		fixture.detectChanges();
		const sent = vi.fn();
		fixture.componentInstance.sent.subscribe(sent);
		return { c: fixture.componentInstance as unknown as Form, fixture, sent };
	}

	it('ticks and unticks choices, and starts a list on a field that has none', () => {
		const { c } = make({});
		expect(c.has('tags', 'a')).toBe(true);
		expect(c.has('name', 'a')).toBe(false);
		c.flip('tags', 'b');
		c.flip('tags', 'a');
		expect(c.values()['tags']).toEqual(['b']);
		c.flip('name', 'x');
		expect(c.values()['name']).toEqual(['x']);
		c.set('size', 's-1');
		expect(c.values()['size']).toBe('s-1');
	});

	it('sends the values it has, forgets the secret, follows the change and reads the lists again once it ends', async () => {
		const running = job('running', 'job_2');
		const productJobs = vi.fn(async () => [job('running', 'job_0')]);
		const sendProductForm = vi.fn(async () => running);
		const { c, sent, fixture } = make({ productJobs, sendProductForm });
		client.setQueryData(['product-jobs', 'proj_1', 'shop', 'droplets'], [job('done', 'job_0'), running]);
		c.pin.set('123456');
		c.typed.set('web-1');
		c.confirming.set(true);
		await c.send();
		const values = (sendProductForm.mock.calls[0] as unknown[])[4] as { values: Record<string, unknown> };
		expect(values.values).toEqual({ name: 'web-1', tags: ['a'], token: 'xyz' });
		expect(c.values()['token']).toBe('');
		expect(c.confirming()).toBe(false);
		expect(sent).toHaveBeenCalledWith(running);
		const invalidate = vi.spyOn(client, 'invalidateQueries');
		productJobs.mockResolvedValue([job('done', 'job_2')]);
		await client.refetchQueries({ queryKey: ['product-jobs'] });
		fixture.detectChanges();
		await vi.waitFor(() => expect(c.job()?.state).toBe('done'));
		fixture.detectChanges();
		expect(invalidate).toHaveBeenCalled();
	});

	it('sends a form without secrets onto an empty list, and says why it was refused', async () => {
		const sendProductForm = vi.fn(async () => job('running', 'job_3'));
		const { c, fixture } = make({ productJobs: vi.fn(async () => []), sendProductForm }, false);
		fixture.componentRef.setInput('form', { ...FORM, fields: [field('name', 'text', 'web-2')] });
		fixture.detectChanges();
		await c.send();
		expect(c.values()).toEqual({ name: 'web-2' });
		sendProductForm.mockRejectedValueOnce(new Error('Wrong PIN'));
		await c.send();
		expect(c.error()).toBe('Wrong PIN');
		sendProductForm.mockRejectedValueOnce('down');
		await c.send();
		expect(c.error()).toBe('The console API did not answer.');
		expect(c.busy()).toBe(false);
	});
});

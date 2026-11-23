/**
 * Most products share one lifecycle: a list, one item's Use tab, create/edit/operate forms, a
 * delete with the typed name, a monitor and a history. A spec names the reads and the fields; this
 * turns it into the screen's tabs and forms.
 */
import type {
	ProductCell,
	ProductFact,
	ProductField,
	ProductLink,
	ProductNote,
	ProductSeries,
	ProductStat,
	ProductTab,
	ProductTable,
} from '@saha-textile/release-console-contracts';

import type { Follow, ProductCtx, ProductFormSpec, ProductScreen, Sent, Write } from './kit.js';
import {
	action,
	col,
	confirmed,
	form,
	formTab,
	monitorTab,
	note,
	pick,
	row,
	table,
	toneOf,
	view,
	when,
} from './kit.js';
import { VendorError, str } from '../vendors/http.js';

export type Item = Record<string, unknown>;

export interface FormPart {
	title: string;
	submit: string;
	fields(ctx: ProductCtx, item: Item | null): Promise<ProductField[]> | ProductField[];
	cost?: string | ((item: Item | null) => string | null);
	notes?: ProductNote[] | ((item: Item | null) => ProductNote[]);
	/** Why the form cannot be sent right now (no key right, vendor limit…). */
	blocked?: (ctx: ProductCtx, item: Item | null) => Promise<string | null> | string | null;
	danger?: boolean;
	/** One-way changes ask for the item's name to be typed. */
	typed?: boolean;
	send(ctx: ProductCtx, w: Write, key: string, item: Item | null): Promise<Sent>;
}

export interface ResourceSpec {
	vendor: ProductScreen['vendor'];
	noun: string;
	nouns: string;
	/** Every item, newest first. */
	items(ctx: ProductCtx): Promise<Item[]>;
	id(i: Item): string;
	name(i: Item): string;
	status?(i: Item): string;
	columns: Array<[key: string, label: string, mono: boolean, cell: (i: Item) => ProductCell]>;
	stats?(items: Item[], ctx: ProductCtx): ProductStat[] | Promise<ProductStat[]>;
	notes?(items: Item[], ctx: ProductCtx): ProductNote[] | Promise<ProductNote[]>;
	extraTables?(items: Item[], ctx: ProductCtx): Promise<ProductTable[]>;
	empty: string;
	/** The Use tab: one item read again in full, its facts, tables and links. */
	one?(ctx: ProductCtx, id: string): Promise<Item>;
	facts?(i: Item): ProductFact[];
	tables?(ctx: ProductCtx, i: Item): Promise<ProductTable[]>;
	links?(i: Item): ProductLink[];
	create?: FormPart;
	edit?: FormPart;
	op?: FormPart & { label?: string };
	destroy?: Omit<FormPart, 'title' | 'submit' | 'fields' | 'send'> & {
		submit?: string;
		fields?: FormPart['fields'];
		remove(ctx: ProductCtx, key: string, item: Item, w: Write): Promise<Sent | void>;
	};
	monitor?(ctx: ProductCtx, i: Item): Promise<{ series: ProductSeries[]; notes?: ProductNote[] }>;
	/** Back up tab: its own view, or why the product holds nothing to back up. */
	backup?: { none: string } | { view(ctx: ProductCtx, i: Item): Promise<ProductTab> };
	history?(ctx: ProductCtx, i: Item | null): Promise<Array<{ at: string; what: string; state?: string }>>;
	/** Extra list-level forms (buttons on the list), by key. */
	forms?: Record<string, ProductFormSpec>;
	/** Extra tabs the screen draws (a second list, uptime checks…). */
	tabs?: Record<string, (ctx: ProductCtx) => Promise<ProductTab>>;
	/** Buttons on the list. */
	listActions?: Array<[label: string, form: string, tone?: 'primary' | 'ghost' | 'danger']>;
	/**
	 * Resources the owner tags with an environment (owner, 23 Nov): the list gets an Environment
	 * column, the Use tab a fact, and deleting the resource drops its tag.
	 */
	envTag?: 'droplet' | 'database' | 'spaces' | 'k8s' | 'app';
	/** Resources whose environment follows something else (the droplets a load balancer sends to). */
	envFrom?: (ctx: ProductCtx, i: Item) => string;
}

const pickerOf = (spec: ResourceSpec, items: Item[], id: string | null) =>
	pick(
		spec.noun[0]?.toUpperCase() + spec.noun.slice(1),
		items.map((i) => ({ value: spec.id(i), label: spec.name(i) })),
		id,
	);

const resolve = <T>(v: T | ((item: Item | null) => T) | undefined, item: Item | null): T | undefined =>
	typeof v === 'function' ? (v as (item: Item | null) => T)(item) : v;

export function resource(spec: ResourceSpec): ProductScreen {
	const noItems = (what: string) =>
		view({
			notes: [
				note(`No ${spec.nouns} on this account yet.${spec.create ? ` Create one from ${what}.` : ''}`, 'muted'),
			],
			actions: spec.create ? [action(`Create ${spec.noun}`, 'create', 'primary')] : [],
		});

	async function chosen(
		ctx: ProductCtx,
	): Promise<{ items: Item[]; item: Item | null; picker: ReturnType<typeof pickerOf> }> {
		const items = await spec.items(ctx);
		const picker = pickerOf(spec, items, ctx.id);
		const listed = items.find((i) => spec.id(i) === picker.value) ?? null;
		const item = listed && spec.one ? await spec.one(ctx, spec.id(listed)) : listed;
		return { items, item, picker };
	}

	function formOf(key: string, part: FormPart, needsItem: boolean): ProductFormSpec {
		return {
			async read(ctx) {
				const { item, picker } = needsItem ? await chosen(ctx) : { item: null, picker: null };
				const blockedByItem = needsItem && !item ? `No ${spec.nouns} on this account yet.` : null;
				return formTab(
					form({
						key,
						title: needsItem && item ? `${part.title} ${spec.name(item)}` : part.title,
						submit: part.submit,
						fields: blockedByItem ? [] : await part.fields(ctx, item),
						cost: resolve(part.cost, item) ?? null,
						notes: resolve(part.notes, item) ?? [],
						danger: !!part.danger,
						confirmName: part.typed && item ? spec.name(item) : null,
						blocked: blockedByItem ?? (part.blocked ? await part.blocked(ctx, item) : null),
					}),
					picker,
				);
			},
			async send(ctx, w) {
				const key = await ctx.writeKey();
				let item: Item | null = null;
				if (needsItem) {
					const id = w.id ?? ctx.id;
					if (!id) throw new VendorError(`Choose a ${spec.noun}.`, 400);
					const items = await spec.items({ ...ctx, key });
					item = items.find((i) => spec.id(i) === id) ?? null;
					if (!item) throw new VendorError(`No ${spec.noun} ${id} on the account any more.`, 404);
					if (spec.one) item = await spec.one({ ...ctx, key }, id);
					if (part.typed) confirmed(w, spec.name(item));
				}
				return part.send(ctx, w, key, item);
			},
		};
	}

	const tabs: ProductScreen['tabs'] = {};
	const forms: Record<string, ProductFormSpec> = { ...(spec.forms ?? {}) };

	const envOf = (ctx: ProductCtx, i: Item) =>
		spec.envTag
			? (ctx.envTags()[`do:${spec.envTag}:${spec.id(i)}`] ?? 'no environment')
			: spec.envFrom
				? spec.envFrom(ctx, i)
				: null;
	const labelled = !!(spec.envTag || spec.envFrom);

	tabs['list'] = async (ctx) => {
		const items = await spec.items(ctx);
		if (spec.envTag && items.length < 2000) ctx.pruneEnvTags(spec.envTag, items.map(spec.id));
		const columns: ResourceSpec['columns'] = labelled
			? [...spec.columns, ['env', 'Environment', false, () => null]]
			: spec.columns;
		const [stats, notes, extra] = await Promise.all([
			spec.stats?.(items, ctx) ?? [],
			spec.notes?.(items, ctx) ?? [],
			spec.extraTables?.(items, ctx) ?? [],
		]);
		return view({
			stats,
			notes,
			tables: [
				table(
					spec.nouns[0]?.toUpperCase() + spec.nouns.slice(1),
					columns.map(([k, l, m]) => col(k, l, m)),
					items.map((i) =>
						row(
							spec.id(i),
							spec.name(i),
							{
								...Object.fromEntries(spec.columns.map(([k, , , cell]) => [k, cell(i)])),
								...(labelled ? { env: envOf(ctx, i) } : {}),
							},
							spec.status ? toneOf(spec.status(i)) : null,
						),
					),
					spec.empty,
					true,
				),
				...extra,
			],
			actions: [
				...(spec.create ? [action(`Create ${spec.noun}`, 'create', 'primary' as const)] : []),
				...(spec.listActions ?? []).map(([l, f, t]) => action(l, f, t ?? 'ghost')),
				...(spec.envTag ? [action('Tag environment', 'envtag')] : []),
			],
		});
	};

	tabs['detail'] = async (ctx) => {
		const { item, picker } = await chosen(ctx);
		if (!item) return noItems('the list');
		const status = spec.status?.(item) ?? '';
		return view(
			{
				head: { name: spec.name(item), status, tone: status ? toneOf(status) : null },
				facts: [
					...(spec.facts?.(item) ??
						spec.columns.map(([, l, , cell]) => [l, String(cell(item) ?? '—'), null] as ProductFact)),
					...(labelled ? [['Environment', envOf(ctx, item) ?? '—', null] as ProductFact] : []),
				],
				tables: spec.tables ? await spec.tables(ctx, item) : [],
				links: spec.links?.(item) ?? [],
				actions: [
					...(spec.edit ? [action('Edit', 'edit')] : []),
					...(spec.op ? [action(spec.op.label ?? 'Operate', 'op')] : []),
					...(spec.destroy ? [action(spec.destroy.submit ?? 'Destroy', 'destroy', 'danger' as const)] : []),
				],
			},
			picker,
		);
	};

	if (spec.create) {
		forms['create'] = formOf('create', spec.create, false);
		tabs['create'] = forms['create'].read;
	}
	if (spec.edit) {
		forms['edit'] = formOf('edit', spec.edit, true);
		tabs['edit'] = forms['edit'].read;
	}
	if (spec.op) {
		forms['op'] = formOf('op', spec.op, true);
		tabs['op'] = forms['op'].read;
	}
	if (spec.destroy) {
		const d = spec.destroy;
		forms['destroy'] = formOf(
			'destroy',
			{
				title: d.submit ?? 'Destroy',
				submit: d.submit ?? `Destroy ${spec.noun}`,
				fields: d.fields ?? (() => []),
				cost: d.cost,
				notes: d.notes,
				blocked: d.blocked,
				danger: true,
				typed: true,
				async send(ctx, w, key, item) {
					if (!item) throw new VendorError(`Choose a ${spec.noun}.`, 400);
					const sent = await d.remove(ctx, key, item, w);
					if (spec.envTag) ctx.setEnvTag(`do:${spec.envTag}:${spec.id(item)}`, null);
					return (
						sent ?? {
							message: `${spec.noun[0]?.toUpperCase()}${spec.noun.slice(1)} ${spec.name(item)} deleted`,
							productId: null,
							follow: [],
						}
					);
				},
			},
			true,
		);
		tabs['destroy'] = forms['destroy'].read;
	}
	if (spec.monitor) {
		const m = spec.monitor;
		tabs['monitor'] = async (ctx) => {
			const { item, picker } = await chosen(ctx);
			if (!item) return monitorTab([], [note(`No ${spec.nouns} on this account yet.`, 'muted')], picker);
			const r = await m(ctx, item);
			return monitorTab(
				r.series,
				r.notes ?? (r.series.length ? [] : [note('No measurements for this range yet.', 'muted')]),
				picker,
			);
		};
	}
	if (spec.backup) {
		const b = spec.backup;
		tabs['backup'] = async (ctx) => {
			if ('none' in b) return view({ notes: [note(b.none, 'muted')] });
			const { item, picker } = await chosen(ctx);
			if (!item) return noItems('the list');
			const t = await b.view(ctx, item);
			return t.type === 'view' || t.type === 'monitor' || t.type === 'form' ? { ...t, picker } : t;
		};
	}
	{
		tabs['history'] = async (ctx) => {
			const items = await spec.items(ctx);
			const picker = items.length ? pickerOf(spec, items, ctx.id) : null;
			const item = items.find((i) => spec.id(i) === picker?.value) ?? null;
			const rows = spec.history ? await spec.history(ctx, item) : [];
			return view(
				{
					tables: [
						table(
							item ? `Changes to ${spec.name(item)}` : 'Changes',
							[col('at', 'When', true), col('what', 'What'), col('state', 'Result')],
							rows.map((r, n) =>
								row(
									String(n),
									r.what,
									{ at: when(r.at), what: r.what, state: r.state ?? '' },
									r.state ? toneOf(r.state) : null,
								),
							),
							'Nothing recorded yet.',
						),
					],
					notes: [
						note(
							'What was pressed in the console, by whom and with the PIN, is in Governance › Audit.',
							'muted',
						),
					],
				},
				picker,
			);
		};
	}
	Object.assign(tabs, spec.tabs ?? {});
	return { vendor: spec.vendor, tabs, forms };
}

/** "created" rows for a product the vendor dates but keeps no change log for. */
export const createdRow = (i: Item, what: string, field = 'created_at') => ({ at: str(i[field]), what, state: '' });

export const followNone: Follow[] = [];

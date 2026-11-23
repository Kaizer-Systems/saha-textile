/**
 * DigitalOcean › Droplets (Use, Edit, Monitor, Back up, Operate, History), Volumes and Backups and
 * snapshots, read live and changed only after the PIN (brief v7 lifecycle).
 */
import type { Follow, ProductCtx, ProductScreen, Sent, Write } from './kit.js';
import {
	action,
	ago,
	bytes,
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	int,
	monitorTab,
	note,
	option,
	pick,
	row,
	slug,
	stat,
	table,
	text,
	toneOf,
	usd,
	view,
	when,
} from './kit.js';
import {
	envAttached,
	actionDone,
	doAll,
	doGet,
	doSend,
	doSoft,
	dropletAction,
	dropletName,
	dropletSeries,
	dropletsOf,
	laterAction,
	regionSlug,
} from './do-kit.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const PORTAL = 'https://cloud.digitalocean.com';
/** DigitalOcean's list prices (Nov 2026) for what the forms say before sending. */
const SNAPSHOT_PER_GB = 0.06;
const VOLUME_PER_GB = 0.1;

/* ===== Droplets: one droplet's own tabs ===== */

async function dropletPicker(ctx: ProductCtx) {
	const droplets = await dropletsOf(ctx.key);
	return {
		droplets,
		picker: pick(
			'Droplet',
			droplets.map((d) => ({ value: String(num(d['id'])), label: str(d['name']) })),
			ctx.id,
		),
	};
}

async function oneDroplet(ctx: ProductCtx, id: string) {
	return rec((await doGet(`/droplets/${encodeURIComponent(id)}`, ctx.key))['droplet']);
}

const noDroplet = view({
	notes: [note('No droplets on this account yet. Create one from the Droplets list.', 'muted')],
});

function addresses(d: Record<string, unknown>) {
	const v4 = arr(rec(d['networks'])['v4']).map(rec);
	const v6 = arr(rec(d['networks'])['v6']).map(rec);
	return {
		pub: str(v4.find((n) => n['type'] === 'public')?.['ip_address']),
		priv: str(v4.find((n) => n['type'] === 'private')?.['ip_address']),
		v6: str(v6[0]?.['ip_address']),
	};
}

const dropletUse = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value) return noDroplet;
	const [d, volumes, firewalls, snaps] = await Promise.all([
		oneDroplet(ctx, picker.value),
		doAll('/volumes', 'volumes', ctx.key, true),
		doAll('/firewalls', 'firewalls', ctx.key, true),
		doAll(`/droplets/${picker.value}/snapshots`, 'snapshots', ctx.key, true),
	]);
	const ip = addresses(d);
	const size = rec(d['size']);
	const image = rec(d['image']);
	const tags = arr(d['tags']).map((t) => str(t));
	const mine = (firewalls ?? []).filter(
		(f) =>
			arr(f['droplet_ids']).some((x) => num(x) === num(d['id'])) ||
			arr(f['tags']).some((t) => tags.includes(str(t))),
	);
	const vols = (volumes ?? []).filter((v) => arr(v['droplet_ids']).some((x) => num(x) === num(d['id'])));
	const features = arr(d['features']).map((f) => str(f));
	return view(
		{
			head: { name: str(d['name']), status: str(d['status']), tone: toneOf(str(d['status'])) },
			stats: [
				stat('Monthly', usd(num(size['price_monthly'])), str(d['size_slug'])),
				stat('CPU · memory', `${num(d['vcpus'])} · ${bytes(num(d['memory']) * 1024 * 1024)}`),
				stat('Disk', `${num(d['disk'])} GB`, `${vols.length} volume${vols.length === 1 ? '' : 's'}`),
				stat('Firewalls', mine.length, mine.length ? 'protecting it' : 'none: open to the internet'),
			],
			facts: [
				fact('Region', regionSlug(d['region'])),
				fact('Image', `${str(image['distribution'])} ${str(image['name'])}`.trim()),
				fact('Public IPv4', ip.pub),
				fact('Private IPv4', ip.priv),
				fact('IPv6', ip.v6 || 'off'),
				fact('VPC', str(d['vpc_uuid'])),
				fact('Tags', tags.join(', ')),
				fact(
					'Backups',
					features.includes('backups') ? 'on' : 'off',
					features.includes('backups') ? 'ok' : 'amber',
				),
				fact(
					'Monitoring agent',
					features.includes('monitoring') ? 'on' : 'off',
					features.includes('monitoring') ? 'ok' : 'amber',
				),
				fact('Created', `${when(str(d['created_at']))} (${ago(str(d['created_at']))})`),
			],
			tables: [
				table(
					'Volumes',
					[col('name', 'Volume'), col('size', 'Size', true), col('fs', 'Filesystem', true)],
					vols.map((v) =>
						row(str(v['id']), str(v['name']), {
							name: str(v['name']),
							size: `${num(v['size_gigabytes'])} GiB`,
							fs: str(v['filesystem_type']) || '—',
						}),
					),
					'No volumes attached.',
				),
				table(
					'Firewalls',
					[col('name', 'Firewall'), col('by', 'Applied by'), col('status', 'Status')],
					mine.map((f) =>
						row(
							str(f['id']),
							str(f['name']),
							{
								name: str(f['name']),
								by: arr(f['droplet_ids']).some((x) => num(x) === num(d['id']))
									? 'droplet'
									: `tag ${arr(f['tags'])
											.map((t) => str(t))
											.filter((t) => tags.includes(t))
											.join(', ')}`,
								status: str(f['status']),
							},
							toneOf(str(f['status'])),
						),
					),
					'No Cloud Firewall protects this droplet.',
				),
				table(
					'Snapshots',
					[col('name', 'Snapshot'), col('size', 'Size', true), col('at', 'Taken', true)],
					(snaps ?? []).map((s) =>
						row(str(s['id']), str(s['name']), {
							name: str(s['name']),
							size: `${num(s['size_gigabytes'])} GB`,
							at: when(str(s['created_at'])),
						}),
					),
					'No snapshots.',
				),
			],
			links: [
				{ label: 'Open in DigitalOcean', url: `${PORTAL}/droplets/${num(d['id'])}` },
				{ label: 'Recovery Console', url: `${PORTAL}/droplets/${num(d['id'])}/console` },
			],
			actions: [
				action('Resize or rename', 'edit'),
				action('Power and rebuild', 'op'),
				action('Snapshot now', 'snapshot', 'primary'),
			],
		},
		picker,
	);
};

const dropletEditForm = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value)
		return formTab(
			form({
				key: 'edit',
				title: 'Resize or rename',
				submit: 'Save changes',
				blocked: 'No droplets on this account yet.',
			}),
			picker,
		);
	const [d, sizes] = await Promise.all([oneDroplet(ctx, picker.value), doAll('/sizes', 'sizes', ctx.key)]);
	const region = regionSlug(d['region']);
	const current = str(d['size_slug']);
	const usable = (sizes ?? []).filter(
		(s) => s['available'] === true && arr(s['regions']).some((r) => str(r) === region),
	);
	return formTab(
		form({
			key: 'edit',
			title: `Edit ${str(d['name'])}`,
			submit: 'Save changes',
			fields: [
				field('name', 'Name', 'text', { value: str(d['name']), required: true }),
				field('size', 'Size', 'select', {
					value: current,
					options: usable.map((s) =>
						option(
							str(s['slug']),
							`${str(s['slug'])} · ${num(s['vcpus'])} vCPU · ${bytes(num(s['memory']) * 1024 * 1024)} · ${num(s['disk'])} GB`,
							`${usd(num(s['price_monthly']))} a month${str(s['slug']) === current ? ' · now' : ''}`,
						),
					),
				}),
				field('disk', 'Grow the disk too', 'toggle', {
					value: false,
					help: 'Permanent: a droplet with a bigger disk cannot go back to a smaller size. Without it, CPU and memory change and the disk stays.',
				}),
			],
			notes: [
				note(
					'Resizing powers the droplet off for about a minute, resizes, and powers it back on. The site is down meanwhile on a single server.',
					'amber',
				),
			],
			cost: `Now ${usd(num(rec(d['size'])['price_monthly']))} a month; the new size's price shows next to it.`,
		}),
		picker,
	);
};

const dropletEditSend = async (ctx: ProductCtx, w: Write): Promise<Sent> => {
	const id = w.id ?? ctx.id;
	if (!id) throw new VendorError('Choose a droplet.', 400);
	const key = await ctx.writeKey();
	const d = await oneDroplet({ ...ctx, key }, id);
	const name = slug(text(w, 'name'));
	const size = text(w, 'size');
	const follow = [];
	if (name !== str(d['name'])) {
		const rid = await dropletAction(id, key, { type: 'rename', name });
		follow.push(actionDone(`Renamed to ${name}`, () => rid));
	}
	if (size !== str(d['size_slug'])) {
		const on = str(d['status']) === 'active';
		if (on) follow.push(laterAction('Powered off', (k) => dropletAction(id, k, { type: 'power_off' })));
		follow.push(
			laterAction(`Resized to ${size}`, (k) =>
				dropletAction(id, k, { type: 'resize', size, disk: w.values['disk'] === true }),
			),
		);
		if (on) follow.push(laterAction('Powered on', (k) => dropletAction(id, k, { type: 'power_on' })));
	}
	if (!follow.length) throw new VendorError('Nothing changed.', 400);
	return { message: `Changing ${str(d['name'])}`, productId: id, follow };
};

const OPS: Array<[string, string, string]> = [
	['reboot', 'Reboot', 'A clean restart from inside the server.'],
	['power_cycle', 'Power cycle', 'A hard restart, like pulling the plug and plugging it back in.'],
	['shutdown', 'Shut down', 'A clean shutdown. A stopped droplet is still billed.'],
	['power_on', 'Power on', ''],
	[
		'rebuild',
		'Rebuild from an image',
		'Wipes the disk and installs the chosen image. Everything on the disk is lost.',
	],
	['enable_backups', 'Turn DigitalOcean backups on', 'Weekly backups, 20% of the droplet price.'],
	['disable_backups', 'Turn DigitalOcean backups off', 'Existing backups are deleted by DigitalOcean.'],
];

const dropletOpForm = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value)
		return formTab(
			form({ key: 'op', title: 'Power and rebuild', submit: 'Run', blocked: 'No droplets on this account yet.' }),
			picker,
		);
	const [d, images] = await Promise.all([
		oneDroplet(ctx, picker.value),
		doAll('/images?type=distribution', 'images', ctx.key),
	]);
	return formTab(
		form({
			key: 'op',
			title: `Operate ${str(d['name'])}`,
			submit: 'Run',
			fields: [
				field('op', 'What to do', 'cards', {
					value: 'reboot',
					options: OPS.map(([v, l, s]) => option(v, l, s)),
				}),
				field('image', 'Image (rebuild only)', 'select', {
					value: str(rec(d['image'])['slug']) || null,
					options: (images ?? [])
						.filter((i) => str(i['slug']))
						.map((i) => option(str(i['slug']), `${str(i['distribution'])} ${str(i['name'])}`)),
				}),
			],
			confirmName: str(d['name']),
			notes: [note('Rebuilding wipes the disk: type the droplet name to confirm any operation.', 'amber')],
			danger: true,
		}),
		picker,
	);
};

const dropletOpSend = async (ctx: ProductCtx, w: Write): Promise<Sent> => {
	const id = w.id ?? ctx.id;
	if (!id) throw new VendorError('Choose a droplet.', 400);
	const key = await ctx.writeKey();
	const d = await oneDroplet({ ...ctx, key }, id);
	confirmed(w, str(d['name']));
	const op = text(w, 'op');
	const known = OPS.find(([v]) => v === op);
	if (!known) throw new VendorError('Choose an operation.', 400);
	const body: Record<string, unknown> = { type: op };
	if (op === 'rebuild') body['image'] = text(w, 'image');
	const aid = await dropletAction(id, key, body);
	return { message: `${known[1]}: ${str(d['name'])}`, productId: id, follow: [actionDone(known[1], () => aid)] };
};

const dropletMonitor = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value) return monitorTab([], [note('No droplets on this account yet.', 'muted')], picker);
	const series = await dropletSeries(ctx, picker.value);
	return monitorTab(
		series,
		series.length
			? []
			: [
					note(
						'No metrics: the DigitalOcean monitoring agent is not on this droplet, or it has not reported yet. New servers from the console get it.',
						'amber',
					),
				],
		picker,
	);
};

const dropletBackups = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value) return noDroplet;
	const [d, backups, snaps, policy] = await Promise.all([
		oneDroplet(ctx, picker.value),
		doAll(`/droplets/${picker.value}/backups`, 'backups', ctx.key, true),
		doAll(`/droplets/${picker.value}/snapshots`, 'snapshots', ctx.key, true),
		doSoft(`/droplets/${picker.value}/backups/policy`, ctx.key),
	]);
	const p = rec(rec(rec(policy)['policy'])['backup_policy']);
	const on = arr(d['features']).some((f) => str(f) === 'backups');
	const both = [
		...(backups ?? []).map((b) =>
			row(str(b['id']), str(b['name']), {
				kind: 'DigitalOcean backup',
				name: str(b['name']),
				size: `${num(b['size_gigabytes'])} GB`,
				at: when(str(b['created_at'])),
			}),
		),
		...(snaps ?? []).map((s) =>
			row(str(s['id']), str(s['name']), {
				kind: 'Snapshot',
				name: str(s['name']),
				size: `${num(s['size_gigabytes'])} GB`,
				at: when(str(s['created_at'])),
			}),
		),
	];
	const snapGb = (snaps ?? []).reduce((a, s) => a + num(s['size_gigabytes']), 0);
	return view(
		{
			head: { name: str(d['name']), status: on ? 'backups on' : 'backups off', tone: on ? 'ok' : 'amber' },
			stats: [
				stat(
					'DigitalOcean backups',
					(backups ?? []).length,
					on
						? `${str(p['plan']) || 'weekly'}${str(p['weekday']) ? ` · ${str(p['weekday'])}` : ''}${p['hour'] !== undefined ? ` · ${num(p['hour'])}:00 UTC` : ''}`
						: 'off',
				),
				stat('Snapshots', (snaps ?? []).length, `${snapGb} GB · ${usd(snapGb * SNAPSHOT_PER_GB)} a month`),
			],
			tables: [
				table(
					'Backups and snapshots',
					[col('kind', 'Kind'), col('name', 'Name'), col('size', 'Size', true), col('at', 'Taken', true)],
					both,
					'No backups or snapshots of this droplet.',
				),
			],
			notes: [
				note(
					'Nightly database backups are on Backups and snapshots; these copy the whole server disk.',
					'muted',
				),
			],
			actions: [
				action('Snapshot now', 'snapshot', 'primary'),
				action('Restore…', 'restore'),
				action(on ? 'Turn backups off' : 'Turn backups on', 'op'),
			],
		},
		picker,
	);
};

const snapshotForm = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value)
		return formTab(
			form({
				key: 'snapshot',
				title: 'Snapshot now',
				submit: 'Take snapshot',
				blocked: 'No droplets on this account yet.',
			}),
			picker,
		);
	const d = await oneDroplet(ctx, picker.value);
	const day = new Date().toISOString().slice(0, 10);
	return formTab(
		form({
			key: 'snapshot',
			title: `Snapshot ${str(d['name'])}`,
			submit: 'Take snapshot',
			fields: [field('name', 'Snapshot name', 'text', { value: `${str(d['name'])}-${day}`, required: true })],
			cost: `About ${usd(num(d['disk']) * SNAPSHOT_PER_GB)} a month at most (${num(d['disk'])} GB disk × $${SNAPSHOT_PER_GB}/GB; billed on the used size).`,
			notes: [
				note(
					'A live snapshot is taken without powering off; for a consistent database copy, use the nightly database backup.',
					'muted',
				),
			],
		}),
		picker,
	);
};

const restoreForm = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value)
		return formTab(
			form({ key: 'restore', title: 'Restore', submit: 'Restore', blocked: 'No droplets on this account yet.' }),
			picker,
		);
	const [d, backups, snaps] = await Promise.all([
		oneDroplet(ctx, picker.value),
		doAll(`/droplets/${picker.value}/backups`, 'backups', ctx.key, true),
		doAll(`/droplets/${picker.value}/snapshots`, 'snapshots', ctx.key, true),
	]);
	const options = [
		...(backups ?? []).map((b) =>
			option(`backup:${num(b['id'])}`, `Backup ${str(b['name'])}`, when(str(b['created_at']))),
		),
		...(snaps ?? []).map((s) =>
			option(`snapshot:${str(s['id'])}`, `Snapshot ${str(s['name'])}`, when(str(s['created_at']))),
		),
	];
	return formTab(
		form({
			key: 'restore',
			title: `Restore ${str(d['name'])}`,
			submit: 'Restore over this droplet',
			fields: [
				field('from', 'Restore from', 'select', { options, value: options[0]?.value ?? null, required: true }),
			],
			confirmName: str(d['name']),
			danger: true,
			blocked: options.length ? null : 'This droplet has no backups or snapshots to restore from.',
			notes: [
				note(
					'Everything written to the disk after that backup is lost. Take a snapshot first if unsure.',
					'red',
				),
			],
		}),
		picker,
	);
};

const restoreSend = async (ctx: ProductCtx, w: Write): Promise<Sent> => {
	const id = w.id ?? ctx.id;
	if (!id) throw new VendorError('Choose a droplet.', 400);
	const key = await ctx.writeKey();
	const d = await oneDroplet({ ...ctx, key }, id);
	confirmed(w, str(d['name']));
	const [kind, image] = text(w, 'from').split(':');
	if (!image || (kind !== 'backup' && kind !== 'snapshot'))
		throw new VendorError('Choose what to restore from.', 400);
	const aid = await dropletAction(
		id,
		key,
		kind === 'backup' ? { type: 'restore', image: Number(image) } : { type: 'rebuild', image: Number(image) },
	);
	return { message: `Restoring ${str(d['name'])}`, productId: id, follow: [actionDone('Disk restored', () => aid)] };
};

const dropletHistory = async (ctx: ProductCtx) => {
	const { picker } = await dropletPicker(ctx);
	if (!picker.value) return noDroplet;
	const acts = (await doAll(`/droplets/${picker.value}/actions`, 'actions', ctx.key)) ?? [];
	return view(
		{
			tables: [
				table(
					'Every action DigitalOcean recorded',
					[
						col('at', 'Started', true),
						col('type', 'What'),
						col('status', 'Result'),
						col('took', 'Took', true),
					],
					acts.map((a) => {
						const s = Date.parse(str(a['started_at']));
						const e = Date.parse(str(a['completed_at']));
						return row(
							num(a['id']),
							str(a['type']),
							{
								at: when(str(a['started_at'])),
								type: str(a['type']).replace(/_/g, ' '),
								status: str(a['status']),
								took:
									Number.isFinite(s) && Number.isFinite(e)
										? `${Math.max(1, Math.round((e - s) / 1000))} s`
										: '—',
							},
							toneOf(str(a['status'])),
						);
					}),
					'No actions recorded.',
				),
			],
			notes: [note('Who pressed what in the console (with the PIN) is in Governance › Audit.', 'muted')],
		},
		picker,
	);
};

export const dropletScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		detail: dropletUse,
		edit: dropletEditForm,
		monitor: dropletMonitor,
		backup: dropletBackups,
		op: dropletOpForm,
		history: dropletHistory,
	},
	forms: {
		edit: { read: dropletEditForm, send: dropletEditSend },
		op: { read: dropletOpForm, send: dropletOpSend },
		snapshot: {
			read: snapshotForm,
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a droplet.', 400);
				const key = await ctx.writeKey();
				const aid = await dropletAction(id, key, {
					type: 'snapshot',
					name: slug(text(w, 'name'), 'Snapshot name'),
				});
				return {
					message: `Snapshot ${text(w, 'name')}`,
					productId: id,
					follow: [actionDone('Snapshot taken', () => aid)],
				};
			},
		},
		restore: { read: restoreForm, send: restoreSend },
	},
};

/* ===== Volumes ===== */

const volumesList = async (ctx: ProductCtx) => {
	const [vols, droplets] = await Promise.all([doAll('/volumes', 'volumes', ctx.key), dropletsOf(ctx.key)]);
	const all = vols ?? [];
	const gib = all.reduce((a, v) => a + num(v['size_gigabytes']), 0);
	return view({
		stats: [
			stat('Volumes', all.length),
			stat('Size', `${gib} GiB`),
			stat('Monthly', usd(gib * VOLUME_PER_GB), `$${VOLUME_PER_GB}/GiB`),
			stat('Detached', all.filter((v) => !arr(v['droplet_ids']).length).length, 'still billed'),
		],
		tables: [
			table(
				'Block storage volumes',
				[
					col('name', 'Volume'),
					col('size', 'Size', true),
					col('region', 'Region', true),
					col('on', 'Attached to'),
					col('fs', 'Filesystem', true),
					col('at', 'Created', true),
					col('env', 'Environment'),
				],
				all.map((v) =>
					row(
						str(v['id']),
						str(v['name']),
						{
							name: str(v['name']),
							size: `${num(v['size_gigabytes'])} GiB`,
							region: regionSlug(v['region']),
							on:
								arr(v['droplet_ids'])
									.map((x) => dropletName(droplets, x))
									.join(', ') || 'not attached',
							fs: str(v['filesystem_type']) || '—',
							at: when(str(v['created_at'])),
							env: envAttached(ctx, arr(v['droplet_ids'])),
						},
						arr(v['droplet_ids']).length ? null : 'amber',
					),
				),
				'No volumes on this account.',
				true,
			),
		],
		actions: [action('Create volume', 'create', 'primary')],
	});
};

async function volumePicker(ctx: ProductCtx) {
	const vols = (await doAll('/volumes', 'volumes', ctx.key)) ?? [];
	return {
		vols,
		picker: pick(
			'Volume',
			vols.map((v) => ({ value: str(v['id']), label: str(v['name']) })),
			ctx.id,
		),
	};
}
const noVolume = view({
	notes: [note('No volumes on this account yet.', 'muted')],
	actions: [action('Create volume', 'create', 'primary')],
});

const volumeCreateForm = async (ctx: ProductCtx) => {
	const [regions, droplets] = await Promise.all([doAll('/regions', 'regions', ctx.key), dropletsOf(ctx.key)]);
	const usable = (regions ?? []).filter(
		(r) => r['available'] === true && arr(r['features']).some((f) => str(f) === 'storage'),
	);
	return formTab(
		form({
			key: 'create',
			title: 'Create a volume',
			submit: 'Create volume',
			fields: [
				field('name', 'Name', 'text', {
					required: true,
					value: `${ctx.repo.id}-data`,
					help: 'Lowercase letters, digits and dashes.',
				}),
				field('size', 'Size (GiB)', 'number', { value: 100, min: 1, max: 16_384, required: true }),
				field('region', 'Region', 'select', {
					value: usable.find((r) => str(r['slug']) === 'blr1') ? 'blr1' : str(usable[0]?.['slug']),
					options: usable.map((r) => option(str(r['slug']), `${str(r['name'])} · ${str(r['slug'])}`)),
				}),
				field('fs', 'Filesystem', 'select', {
					value: 'ext4',
					options: [option('ext4', 'ext4'), option('xfs', 'XFS'), option('', 'None: format it yourself')],
				}),
				field('droplet', 'Attach to', 'select', {
					value: '',
					options: [
						option('', 'Not now'),
						...droplets.map((d) =>
							option(String(num(d['id'])), `${str(d['name'])} · ${regionSlug(d['region'])}`),
						),
					],
					help: 'Only a droplet in the same region can take it.',
				}),
			],
			cost: `$${VOLUME_PER_GB} per GiB a month: 100 GiB is $10.00 a month, billed by the hour from creation.`,
		}),
	);
};

const volumeCreateSend = async (ctx: ProductCtx, w: Write): Promise<Sent> => {
	const key = await ctx.writeKey();
	const name = slug(text(w, 'name'));
	const size = int(w, 'size', 1, 16_384);
	const region = text(w, 'region');
	const fs = text(w, 'fs', false);
	const droplet = text(w, 'droplet', false);
	const v = rec(
		(
			await doSend('POST', '/volumes', key, {
				name,
				size_gigabytes: size,
				region,
				...(fs ? { filesystem_type: fs } : {}),
				tags: [ctx.repo.id],
			})
		)['volume'],
	);
	const id = str(v['id']);
	const follow: Follow[] = [{ label: `Volume ${name} created (${size} GiB · ${region})`, check: async () => true }];
	if (droplet)
		follow.push(
			laterAction(`Attached to droplet ${droplet}`, async (k) =>
				num(
					rec(
						(
							await doSend('POST', `/volumes/${id}/actions`, k, {
								type: 'attach',
								droplet_id: Number(droplet),
								region,
							})
						)['action'],
					)['id'],
				),
			),
		);
	return { message: `Creating volume ${name}`, productId: id, follow };
};

const volumeUse = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value) return noVolume;
	const [v, snaps, droplets] = await Promise.all([
		doGet(`/volumes/${picker.value}`, ctx.key).then((b) => rec(b['volume'])),
		doAll(`/volumes/${picker.value}/snapshots`, 'snapshots', ctx.key, true),
		dropletsOf(ctx.key),
	]);
	const on = arr(v['droplet_ids']).map((x) => dropletName(droplets, x));
	const name = str(v['name']);
	return view(
		{
			head: { name, status: on.length ? 'attached' : 'detached', tone: on.length ? 'ok' : 'amber' },
			facts: [
				fact(
					'Size',
					`${num(v['size_gigabytes'])} GiB · ${usd(num(v['size_gigabytes']) * VOLUME_PER_GB)} a month`,
				),
				fact('Region', regionSlug(v['region'])),
				fact('Attached to', on.join(', ') || 'nothing'),
				fact(
					'Filesystem',
					`${str(v['filesystem_type']) || 'not formatted'}${str(v['filesystem_label']) ? ` · label ${str(v['filesystem_label'])}` : ''}`,
				),
				fact('Mount (by convention)', on.length ? `/mnt/${name.replace(/-/g, '_')}` : '—'),
				fact('Created', when(str(v['created_at']))),
			],
			tables: [
				table(
					'Snapshots',
					[col('name', 'Snapshot'), col('size', 'Size', true), col('at', 'Taken', true)],
					(snaps ?? []).map((s) =>
						row(str(s['id']), str(s['name']), {
							name: str(s['name']),
							size: `${num(s['size_gigabytes'])} GB`,
							at: when(str(s['created_at'])),
						}),
					),
					'No snapshots.',
				),
			],
			links: [{ label: 'Open in DigitalOcean', url: `${PORTAL}/volumes` }],
			actions: [
				action('Resize', 'edit'),
				action('Attach or detach', 'op'),
				action('Snapshot now', 'snapshot', 'primary'),
			],
		},
		picker,
	);
};

const volumeEditForm = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value)
		return formTab(
			form({ key: 'edit', title: 'Resize', submit: 'Resize', blocked: 'No volumes on this account yet.' }),
			picker,
		);
	const v = rec((await doGet(`/volumes/${picker.value}`, ctx.key))['volume']);
	const now = num(v['size_gigabytes']);
	return formTab(
		form({
			key: 'edit',
			title: `Resize ${str(v['name'])}`,
			submit: 'Grow volume',
			fields: [
				field('size', 'New size (GiB)', 'number', {
					value: now,
					min: now + 1,
					max: 16_384,
					required: true,
					help: `Now ${now} GiB. Volumes grow only; they can never shrink.`,
				}),
			],
			cost: `$${VOLUME_PER_GB} per GiB a month (${now} GiB is ${usd(now * VOLUME_PER_GB)}).`,
			notes: [
				note(
					'After DigitalOcean grows it, the server grows the filesystem (resize2fs or xfs_growfs); Run › Terminal has that command.',
					'muted',
				),
			],
		}),
		picker,
	);
};

const volumeOpForm = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value)
		return formTab(
			form({ key: 'op', title: 'Attach or detach', submit: 'Run', blocked: 'No volumes on this account yet.' }),
			picker,
		);
	const [v, droplets] = await Promise.all([
		doGet(`/volumes/${picker.value}`, ctx.key).then((b) => rec(b['volume'])),
		dropletsOf(ctx.key),
	]);
	const region = regionSlug(v['region']);
	const attached = arr(v['droplet_ids']).map((x) => num(x));
	return formTab(
		form({
			key: 'op',
			title: `Operate ${str(v['name'])}`,
			submit: attached.length ? 'Detach' : 'Attach',
			fields: attached.length
				? [
						field('droplet', 'Detach from', 'select', {
							value: String(attached[0]),
							options: attached.map((x) => option(String(x), dropletName(droplets, x))),
						}),
					]
				: [
						field('droplet', 'Attach to', 'select', {
							options: droplets
								.filter((d) => regionSlug(d['region']) === region)
								.map((d) => option(String(num(d['id'])), str(d['name']))),
							required: true,
							help: `Droplets in ${region} only.`,
						}),
					],
			confirmName: attached.length ? str(v['name']) : null,
			notes: attached.length
				? [note('Unmount it on the server first (Run › Terminal), or files being written are lost.', 'amber')]
				: [],
		}),
		picker,
	);
};

const volumeBackups = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value) return noVolume;
	const snaps = (await doAll(`/volumes/${picker.value}/snapshots`, 'snapshots', ctx.key, true)) ?? [];
	const gb = snaps.reduce((a, s) => a + num(s['size_gigabytes']), 0);
	return view(
		{
			stats: [stat('Snapshots', snaps.length), stat('Kept', `${gb} GB`, `${usd(gb * SNAPSHOT_PER_GB)} a month`)],
			tables: [
				table(
					'Volume snapshots',
					[col('name', 'Snapshot'), col('size', 'Size', true), col('at', 'Taken', true)],
					snaps.map((s) =>
						row(str(s['id']), str(s['name']), {
							name: str(s['name']),
							size: `${num(s['size_gigabytes'])} GB`,
							at: when(str(s['created_at'])),
						}),
					),
					'No snapshots of this volume.',
				),
			],
			actions: [action('Snapshot now', 'snapshot', 'primary')],
			notes: [
				note(
					'Snapshots are kept until deleted (Backups and snapshots › Delete). Restoring makes a new volume from one.',
					'muted',
				),
			],
		},
		picker,
	);
};

const volumeMonitor = async (ctx: ProductCtx) => {
	const { picker, vols } = await volumePicker(ctx);
	const v = vols.find((x) => str(x['id']) === picker.value);
	const droplet = v ? arr(v['droplet_ids'])[0] : undefined;
	if (!v || droplet === undefined)
		return monitorTab(
			[],
			[
				note(
					v
						? 'Detached: nothing writes to it, so there is nothing to chart.'
						: 'No volumes on this account yet.',
					'muted',
				),
			],
			picker,
		);
	const series = (await dropletSeries(ctx, String(num(droplet)), `/mnt/${str(v['name']).replace(/-/g, '_')}`)).filter(
		(s) => s.name.startsWith('Used'),
	);
	return monitorTab(
		series,
		[
			note(
				'DigitalOcean publishes no read and write rates for volumes; used space comes from the droplet agent at the mount point.',
				'muted',
			),
		],
		picker,
	);
};

const volumeHistory = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value) return noVolume;
	const acts = (await doAll(`/volumes/${picker.value}/actions`, 'actions', ctx.key, true)) ?? [];
	return view(
		{
			tables: [
				table(
					'Every action DigitalOcean recorded',
					[col('at', 'Started', true), col('type', 'What'), col('status', 'Result')],
					acts.map((a) =>
						row(
							num(a['id']),
							str(a['type']),
							{
								at: when(str(a['started_at'])),
								type: str(a['type']).replace(/_/g, ' '),
								status: str(a['status']),
							},
							toneOf(str(a['status'])),
						),
					),
					'No actions recorded.',
				),
			],
			notes: [note('Who pressed what in the console is in Governance › Audit.', 'muted')],
		},
		picker,
	);
};

const volumeDestroyForm = async (ctx: ProductCtx) => {
	const { picker } = await volumePicker(ctx);
	if (!picker.value)
		return formTab(
			form({
				key: 'destroy',
				title: 'Destroy',
				submit: 'Destroy volume',
				blocked: 'No volumes on this account yet.',
			}),
			picker,
		);
	const [v, snaps] = await Promise.all([
		doGet(`/volumes/${picker.value}`, ctx.key).then((b) => rec(b['volume'])),
		doAll(`/volumes/${picker.value}/snapshots`, 'snapshots', ctx.key, true),
	]);
	const attached = arr(v['droplet_ids']).length > 0;
	return formTab(
		form({
			key: 'destroy',
			title: `Destroy ${str(v['name'])}`,
			submit: 'Destroy volume',
			danger: true,
			confirmName: str(v['name']),
			fields: [
				field('snapshots', `Delete its ${(snaps ?? []).length} snapshots too`, 'toggle', { value: false }),
			],
			notes: [
				note(
					`Every file on it is deleted.${attached ? ' It is attached: the console detaches it first. Unmount it on the server before.' : ''}`,
					'red',
				),
				note(`Saves ${usd(num(v['size_gigabytes']) * VOLUME_PER_GB)} a month.`, 'ok'),
			],
		}),
		picker,
	);
};

export const volumeScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		list: volumesList,
		create: volumeCreateForm,
		detail: volumeUse,
		edit: volumeEditForm,
		monitor: volumeMonitor,
		backup: volumeBackups,
		op: volumeOpForm,
		destroy: volumeDestroyForm,
		history: volumeHistory,
	},
	forms: {
		create: { read: volumeCreateForm, send: volumeCreateSend },
		edit: {
			read: volumeEditForm,
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a volume.', 400);
				const key = await ctx.writeKey();
				const v = rec((await doGet(`/volumes/${id}`, key))['volume']);
				const size = int(w, 'size', num(v['size_gigabytes']) + 1, 16_384);
				const a = await doSend('POST', `/volumes/${id}/actions`, key, {
					type: 'resize',
					size_gigabytes: size,
					region: regionSlug(v['region']),
				});
				const aid = num(rec(a['action'])['id']);
				return {
					message: `Growing ${str(v['name'])} to ${size} GiB`,
					productId: id,
					follow: [actionDone(`Resized to ${size} GiB`, () => aid)],
				};
			},
		},
		op: {
			read: volumeOpForm,
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a volume.', 400);
				const key = await ctx.writeKey();
				const v = rec((await doGet(`/volumes/${id}`, key))['volume']);
				const attached = arr(v['droplet_ids']).length > 0;
				if (attached) confirmed(w, str(v['name']));
				const a = await doSend('POST', `/volumes/${id}/actions`, key, {
					type: attached ? 'detach' : 'attach',
					droplet_id: Number(text(w, 'droplet')),
					region: regionSlug(v['region']),
				});
				const aid = num(rec(a['action'])['id']);
				return {
					message: `${attached ? 'Detaching' : 'Attaching'} ${str(v['name'])}`,
					productId: id,
					follow: [actionDone(attached ? 'Detached' : 'Attached', () => aid)],
				};
			},
		},
		snapshot: {
			async read(ctx) {
				const { picker, vols } = await volumePicker(ctx);
				const v = vols.find((x) => str(x['id']) === picker.value);
				return formTab(
					form({
						key: 'snapshot',
						title: `Snapshot ${str(v?.['name'])}`,
						submit: 'Take snapshot',
						fields: [
							field('name', 'Snapshot name', 'text', {
								required: true,
								value: `${str(v?.['name'])}-${new Date().toISOString().slice(0, 10)}`,
							}),
						],
						cost: v
							? `About ${usd(num(v['size_gigabytes']) * SNAPSHOT_PER_GB)} a month at most ($${SNAPSHOT_PER_GB}/GB of used space).`
							: null,
						blocked: v ? null : 'No volumes on this account yet.',
					}),
					picker,
				);
			},
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a volume.', 400);
				const key = await ctx.writeKey();
				const s = rec(
					(
						await doSend('POST', `/volumes/${id}/snapshots`, key, {
							name: slug(text(w, 'name'), 'Snapshot name'),
						})
					)['snapshot'],
				);
				return { message: `Snapshot ${str(s['name'])} taken`, productId: id, follow: [] };
			},
		},
		destroy: {
			read: volumeDestroyForm,
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a volume.', 400);
				const key = await ctx.writeKey();
				const v = rec((await doGet(`/volumes/${id}`, key))['volume']);
				confirmed(w, str(v['name']));
				const follow = [];
				for (const dropletId of arr(v['droplet_ids']).map((x) => num(x)))
					follow.push(
						laterAction(`Detached from droplet ${dropletId}`, async (k) =>
							num(
								rec(
									(
										await doSend('POST', `/volumes/${id}/actions`, k, {
											type: 'detach',
											droplet_id: dropletId,
											region: regionSlug(v['region']),
										})
									)['action'],
								)['id'],
							),
						),
					);
				const snaps =
					w.values['snapshots'] === true
						? ((await doAll(`/volumes/${id}/snapshots`, 'snapshots', key, true)) ?? [])
						: [];
				follow.push({
					label: `Volume ${str(v['name'])} deleted`,
					async check(k: string) {
						await doSend('DELETE', `/volumes/${id}`, k);
						return true;
					},
				});
				for (const s of snaps)
					follow.push({
						label: `Snapshot ${str(s['name'])} deleted`,
						async check(k: string) {
							await doSend('DELETE', `/snapshots/${str(s['id'])}`, k);
							return true;
						},
					});
				return { message: `Destroying ${str(v['name'])}`, productId: null, follow };
			},
		},
	},
};

/* ===== Backups and snapshots (account-wide) ===== */

async function allSnapshots(key: string) {
	return (await doAll('/snapshots', 'snapshots', key)) ?? [];
}

const backupsList = async (ctx: ProductCtx) => {
	const [snaps, droplets, vols] = await Promise.all([
		allSnapshots(ctx.key),
		dropletsOf(ctx.key),
		doAll('/volumes', 'volumes', ctx.key, true),
	]);
	const volumes = vols ?? [];
	const backups = (
		await Promise.all(
			droplets.map(async (d) =>
				((await doAll(`/droplets/${num(d['id'])}/backups`, 'backups', ctx.key, true)) ?? []).map(
					(b): Record<string, unknown> => ({ ...b, _droplet: str(d['name']), _dropletId: num(d['id']) }),
				),
			),
		)
	).flat();
	const gb = snaps.reduce((a, s) => a + num(s['size_gigabytes']), 0);
	const rows = [
		...snaps.map((s) =>
			row(str(s['id']), str(s['name']), {
				kind: str(s['resource_type']) === 'volume' ? 'Volume snapshot' : 'Droplet snapshot',
				name: str(s['name']),
				of:
					str(s['resource_type']) === 'droplet'
						? dropletName(droplets, s['resource_id'])
						: str(s['resource_id']),
				size: `${num(s['size_gigabytes'])} GB`,
				where: arr(s['regions'])
					.map((r) => str(r))
					.join(', '),
				at: when(str(s['created_at'])),
				env:
					str(s['resource_type']) === 'droplet'
						? envAttached(ctx, [s['resource_id']])
						: envAttached(
								ctx,
								arr(volumes.find((v) => str(v['id']) === str(s['resource_id']))?.['droplet_ids']),
							),
			}),
		),
		...backups.map((b) =>
			row(`backup:${num(b['id'])}`, str(b['name']), {
				kind: 'DigitalOcean backup',
				name: str(b['name']),
				of: str(b['_droplet']),
				size: `${num(b['size_gigabytes'])} GB`,
				where: arr(b['regions'])
					.map((r) => str(r))
					.join(', '),
				at: when(str(b['created_at'])),
				env: envAttached(ctx, [b['_dropletId']]),
			}),
		),
	].sort((a, b) => String(b.cells['at']).localeCompare(String(a.cells['at'])));
	return view({
		stats: [
			stat('Snapshots', snaps.length, `${gb} GB · ${usd(gb * SNAPSHOT_PER_GB)} a month`),
			stat(
				'DigitalOcean backups',
				backups.length,
				`${droplets.filter((d) => arr(d['features']).some((f) => str(f) === 'backups')).length} of ${droplets.length} droplets on`,
			),
		],
		tables: [
			table(
				'Every backup and snapshot',
				[
					col('kind', 'Kind'),
					col('name', 'Name'),
					col('of', 'Of'),
					col('size', 'Size', true),
					col('where', 'Region', true),
					col('at', 'Taken', true),
					col('env', 'Environment'),
				],
				rows,
				'No backups or snapshots on this account.',
			),
		],
		notes: [
			note(
				'Nightly database backups (mongodump to Spaces) are listed under Spaces › the backup bucket once the stack makes them.',
				'muted',
			),
		],
		actions: [action('Take one now', 'take', 'primary'), action('Restore…', 'restore')],
	});
};

const takeForm = async (ctx: ProductCtx) => {
	const [droplets, vols] = await Promise.all([dropletsOf(ctx.key), doAll('/volumes', 'volumes', ctx.key, true)]);
	const options = [
		...droplets.map((d) =>
			option(`droplet:${num(d['id'])}`, `Droplet ${str(d['name'])}`, `${num(d['disk'])} GB disk`),
		),
		...(vols ?? []).map((v) =>
			option(`volume:${str(v['id'])}`, `Volume ${str(v['name'])}`, `${num(v['size_gigabytes'])} GiB`),
		),
	];
	return formTab(
		form({
			key: 'take',
			title: 'Take a snapshot now',
			submit: 'Take snapshot',
			fields: [
				field('of', 'Of', 'select', { options, value: options[0]?.value ?? null, required: true }),
				field('name', 'Name', 'text', {
					required: true,
					value: `snapshot-${new Date().toISOString().slice(0, 10)}`,
				}),
			],
			cost: `$${SNAPSHOT_PER_GB} per GB of used space a month, kept until deleted.`,
			blocked: options.length ? null : 'No droplets or volumes to snapshot.',
		}),
	);
};

const backupsRestoreForm = async (ctx: ProductCtx) => {
	const snaps = await allSnapshots(ctx.key);
	const droplets = await dropletsOf(ctx.key);
	return formTab(
		form({
			key: 'restore',
			title: 'Restore',
			submit: 'Restore',
			fields: [
				field('from', 'Restore from', 'select', {
					options: snaps.map((s) =>
						option(
							`${str(s['resource_type'])}:${str(s['id'])}`,
							str(s['name']),
							`${str(s['resource_type'])} · ${when(str(s['created_at']))}`,
						),
					),
					value: snaps[0] ? `${str(snaps[0]['resource_type'])}:${str(snaps[0]['id'])}` : null,
					required: true,
				}),
				field('to', 'Droplet snapshot goes over', 'select', {
					options: droplets.map((d) => option(String(num(d['id'])), str(d['name']))),
					help: 'Droplet snapshots rebuild this droplet; volume snapshots become a new volume next to the old one.',
				}),
				field('confirmTarget', 'Type the droplet name (droplet snapshots only)', 'text'),
			],
			danger: true,
			notes: [
				note(
					'Rebuilding wipes the chosen droplet. A volume snapshot never overwrites anything: it makes a new volume.',
					'red',
				),
			],
			blocked: snaps.length ? null : 'No snapshots to restore from.',
		}),
	);
};

const backupsDestroy = async (ctx: ProductCtx) => {
	const snaps = await allSnapshots(ctx.key);
	const p = pick(
		'Snapshot',
		snaps.map((s) => ({ value: str(s['id']), label: str(s['name']) })),
		ctx.id,
	);
	const s = snaps.find((x) => str(x['id']) === p.value);
	return formTab(
		form({
			key: 'destroy',
			title: `Delete ${str(s?.['name'])}`,
			submit: 'Delete snapshot',
			danger: true,
			confirmName: s ? str(s['name']) : null,
			blocked: s ? null : 'No snapshots on this account.',
			notes: s
				? [
						note('Deletes this snapshot only. Nightly database backups are not touched.', 'muted'),
						note(`Saves about ${usd(num(s['size_gigabytes']) * SNAPSHOT_PER_GB)} a month.`, 'ok'),
					]
				: [],
		}),
		p,
	);
};

export const backupsScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		list: backupsList,
		take: takeForm,
		restore: backupsRestoreForm,
		destroy: (ctx) => backupsDestroy(ctx),
		history: async (ctx) => {
			const snaps = await allSnapshots(ctx.key);
			return view({
				tables: [
					table(
						'Snapshots taken, newest first',
						[col('at', 'When', true), col('what', 'What')],
						snaps
							.sort((a, b) => str(b['created_at']).localeCompare(str(a['created_at'])))
							.map((s) =>
								row(str(s['id']), str(s['name']), {
									at: when(str(s['created_at'])),
									what: `${str(s['resource_type'])} snapshot ${str(s['name'])} (${num(s['size_gigabytes'])} GB)`,
								}),
							),
						'Nothing yet.',
					),
				],
				notes: [note('Deletions and restores made in the console are in Governance › Audit.', 'muted')],
			});
		},
	},
	forms: {
		take: {
			read: takeForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const [kind, id] = text(w, 'of').split(':');
				const name = slug(text(w, 'name'));
				if (kind === 'volume' && id) {
					await doSend('POST', `/volumes/${id}/snapshots`, key, { name });
					return { message: `Snapshot ${name} taken`, productId: null, follow: [] };
				}
				if (kind === 'droplet' && id) {
					const aid = await dropletAction(id, key, { type: 'snapshot', name });
					return {
						message: `Snapshot ${name}`,
						productId: null,
						follow: [actionDone('Snapshot taken', () => aid)],
					};
				}
				throw new VendorError('Choose what to snapshot.', 400);
			},
		},
		restore: {
			read: backupsRestoreForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const [kind, id] = text(w, 'from').split(':');
				if (kind === 'volume' && id) {
					const s = rec((await doGet(`/snapshots/${id}`, key))['snapshot']);
					const name = `${str(s['name'])}-restored`.slice(0, 63);
					const v = rec(
						(
							await doSend('POST', '/volumes', key, {
								name,
								snapshot_id: id,
								size_gigabytes: num(s['min_disk_size']) || num(s['size_gigabytes']),
								region: str(arr(s['regions'])[0]),
							})
						)['volume'],
					);
					return {
						message: `New volume ${name} from ${str(s['name'])}`,
						productId: str(v['id']),
						follow: [],
					};
				}
				if (kind === 'droplet' && id) {
					const to = text(w, 'to');
					const d = rec((await doGet(`/droplets/${to}`, key))['droplet']);
					if (text(w, 'confirmTarget') !== str(d['name']))
						throw new VendorError(`Type ${str(d['name'])} to confirm.`, 400);
					const aid = await dropletAction(to, key, { type: 'rebuild', image: Number(id) });
					return {
						message: `Rebuilding ${str(d['name'])} from the snapshot`,
						productId: to,
						follow: [actionDone('Disk rebuilt', () => aid)],
					};
				}
				throw new VendorError('Choose what to restore from.', 400);
			},
		},
		destroy: {
			read: (ctx) => backupsDestroy(ctx),
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a snapshot.', 400);
				const key = await ctx.writeKey();
				const s = rec((await doGet(`/snapshots/${id}`, key))['snapshot']);
				confirmed(w, str(s['name']));
				await doSend('DELETE', `/snapshots/${id}`, key);
				return { message: `Snapshot ${str(s['name'])} deleted`, productId: null, follow: [] };
			},
		},
	},
};

import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { DO_STEPS, DoCreateScreen, cheapestAtLeast, countryOf, gb, money } from './do-create';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { DoCatalog, DoImage, DoRegion, DoSize, DropletDraft } from '@saha-textile/release-console-contracts';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	catalog: () => DoCatalog | null;
	readAt: () => string | null;
	envs: () => string[];
	draft: () => DropletDraft;
	stepKey: () => string;
	stepIndex: () => number;
	nextLabel: () => string;
	imageTab: WritableSignal<string>;
	appSearch: WritableSignal<string>;
	sliderGroup: WritableSignal<'shared' | 'dedicated'>;
	regionVpcs: () => unknown[];
	defaultVpc: () => unknown;
	osGroups: () => Array<{ name: string; versions: DoImage[] }>;
	chosenImage: () => DoImage | undefined;
	chosenOs: () => unknown;
	apps: () => DoImage[];
	cpuGroup: () => string;
	groupFamilies: () => readonly string[];
	planSize: () => string;
	familySizes: () => DoSize[];
	sliderSizes: () => DoSize[];
	sliders: () => Array<{ key: string; values: number[]; index: number; value: number; text: string; pct: number }>;
	sliderPick: () => DoSize | undefined;
	backupPlans: () => Array<{ key: string; note: string }>;
	projectName: () => string;
	domains: () => string[];
	size: () => DoSize | undefined;
	cost: () => { total: number };
	typed: WritableSignal<string>;
	password: WritableSignal<string>;
	password2: WritableSignal<string>;
	pin: WritableSignal<string>;
	busy: WritableSignal<boolean>;
	message: () => string;
	isProduction: () => boolean;
	emails: () => string[];
	confirmProblem: () => string;
	problems: () => string[];
	requestText: () => string;
	summary: () => Array<[string, string, string]>;
	patch(p: Partial<DropletDraft>): void;
	go(tab: string): void;
	next(): void;
	back(): void;
	useEnvironment(environment: string): void;
	pickRegion(r: DoRegion): void;
	imagesOf(kind: string): DoImage[];
	isChosen(i: DoImage): boolean;
	pickImage(i: DoImage | undefined): void;
	offered(s: DoSize): boolean;
	familyCount(f: string): number;
	pickGroup(g: string): void;
	pickFamily(f: string): void;
	pickSize(s: DoSize): void;
	slide(key: string, e: PointerEvent): void;
	slideMove(key: string, e: PointerEvent): void;
	slideKey(key: string, e: KeyboardEvent): void;
	setVolume(v: string): void;
	toggleKey(id: number): void;
	setQuantity(v: string): void;
	setName(v: string): void;
	addTag(input: HTMLInputElement): void;
	removeTag(t: string): void;
	addEmail(input: HTMLInputElement): void;
	removeEmail(e: string): void;
	create(): Promise<void>;
	disk(s: DoSize): string;
}

const region = (slug: string, available = true): DoRegion => ({
	slug,
	name: `Region ${slug}`,
	available,
	sizes: [],
	features: [],
});
const size = (slug: string, family: string, over: Partial<DoSize> = {}): DoSize =>
	({
		slug,
		description: slug,
		family,
		memoryMb: 4096,
		vcpus: 2,
		diskGb: 80,
		transferTb: 4,
		priceMonthly: 24,
		priceHourly: 0.036,
		regions: ['blr1'],
		available: true,
		...over,
	}) as DoSize;
const image = (id: number, over: Partial<DoImage> = {}): DoImage => ({
	id,
	slug: `img-${id}`,
	name: `Image ${id}`,
	distribution: 'Ubuntu',
	kind: 'os',
	regions: ['blr1'],
	minDiskGb: 10,
	sizeGb: null,
	createdAt: '2026-01-01T00:00:00Z',
	of: null,
	...over,
});

const CATALOG: DoCatalog = {
	regions: [region('blr1'), region('sgp1', false), region('fra1')],
	sizes: [
		size('s-2vcpu-4gb', 'regular'),
		size('s-1vcpu-1gb', 'regular', { memoryMb: 1024, vcpus: 1, diskGb: 25, priceMonthly: 6 }),
		size('s-8vcpu-16gb', 'regular', { regions: ['sgp1'], priceMonthly: 96 }),
		size('g-2vcpu-8gb', 'general', { memoryMb: 8192, priceMonthly: 63 }),
		size('s5-1', 'v5shared', { memoryMb: 1024, vcpus: 1, diskGb: 25, priceMonthly: 7 }),
		size('s5-2', 'v5shared', { memoryMb: 2048, vcpus: 2, diskGb: 50, priceMonthly: 14 }),
		size('s5-4', 'v5shared', { memoryMb: 4096, vcpus: 4, diskGb: 100, priceMonthly: 28 }),
		size('g5-2', 'v5general', { memoryMb: 8192, vcpus: 2, diskGb: 50, priceMonthly: 60 }),
		size('g5-4', 'v5general', { memoryMb: 4096, vcpus: 4, diskGb: 50, priceMonthly: 48 }),
		size('gpu-h100', 'gpu', { available: false, priceMonthly: 2000 }),
	],
	images: [
		image(1, { slug: 'ubuntu-26-04-x64', name: '26.04', createdAt: '2026-04-01T00:00:00Z' }),
		image(2, { slug: 'ubuntu-24-04-x64', name: '24.04', createdAt: '2024-04-01T00:00:00Z' }),
		image(3, { slug: 'ubuntu-24-10-x64', name: '24.10', createdAt: '2024-04-01T00:00:00Z' }),
		image(4, { slug: 'debian-13-x64', name: '13', distribution: 'Debian' }),
		image(5, { slug: 'gpu-ubuntu-22', name: 'AI/ML ready', distribution: 'Ubuntu' }),
		image(6, { slug: 'arch-x64', name: 'Rolling', distribution: 'Arch Linux' }),
		image(7, { slug: 'zeta-x64', name: 'One', distribution: 'Zeta' }),
		image(10, { slug: 'wordpress', name: 'WordPress', kind: 'app' }),
		image(11, { slug: 'docker', name: 'Docker', kind: 'app' }),
		image(20, { slug: null, name: 'before-upgrade', kind: 'snapshot' }),
		image(21, { slug: null, name: 'nightly', kind: 'backup' }),
	],
	sshKeys: [{ id: 1, name: 'mac', fingerprint: 'aa' }],
	vpcs: [
		{ id: 'vpc-default', name: 'default-blr1', region: 'blr1', ipRange: '10.0.0.0/20', isDefault: true },
		{ id: 'vpc-own', name: 'shop', region: 'blr1', ipRange: '10.1.0.0/20', isDefault: false },
		{ id: 'vpc-fra', name: 'fra', region: 'fra1', ipRange: '10.2.0.0/20', isDefault: false },
	],
	projects: [
		{ id: 'do-proj-1', name: 'Saha Textile', isDefault: false },
		{ id: 'do-proj-2', name: 'First project', isDefault: true },
	],
	missing: [],
};

function make(
	options: {
		step?: string;
		answer?: unknown;
		projectName?: string | null;
		environments?: Array<{ name: string; cloudId: string; domains: string[] }>;
		cloud?: boolean;
		ids?: boolean;
	} = {},
) {
	const api = {
		doCatalog: vi.fn(async () => options.answer ?? { state: 'ok', readAt: '2026-11-20T10:00:00Z', data: CATALOG }),
		createDroplet: vi.fn(async () => ({ id: 'job-1' })),
	};
	const router = { navigate: vi.fn(async () => true) };
	const repo = {
		cloud: options.cloud === false ? [] : [{ vendor: 'digitalocean', id: 'do1' }],
		environments: options.environments ?? [
			{ name: 'production', cloudId: 'do1', domains: ['example.com'] },
			{ name: 'staging', cloudId: 'do1', domains: ['staging.example.com'] },
		],
	};
	const ctx = {
		projectId: () => (options.ids === false ? null : 'proj_1'),
		repoId: () => (options.ids === false ? null : 'shop'),
		repo: () => repo,
		project: () =>
			options.projectName === null
				? null
				: { name: options.projectName ?? 'Saha Textile', sshEmails: ['a@b.test'] },
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{ provide: ConsoleContext, useValue: ctx },
		],
	});
	TestBed.overrideComponent(DoCreateScreen, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(DoCreateScreen);
	fixture.componentRef.setInput('step', options.step ?? 'region');
	fixture.detectChanges();
	const c = fixture.componentInstance as unknown as Screen;
	const loaded = async () => {
		await vi.waitFor(() => expect(c.catalog()).not.toBeNull());
		fixture.detectChanges();
	};
	return { c, api, router, fixture, loaded };
}

const pointer = (clientX: number, buttons = 1) =>
	({
		clientX,
		buttons,
		pointerId: 1,
		currentTarget: {
			getBoundingClientRect: () => ({ left: 0, width: 100 }),
			setPointerCapture: vi.fn(),
		},
	}) as unknown as PointerEvent;
const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
const input = (value: string) => Object.assign(document.createElement('input'), { value });

describe('DigitalOcean create: helpers', () => {
	it('words sizes and prices, and finds the cheapest size with enough of everything', () => {
		expect(gb(512)).toBe('512 MB');
		expect(gb(1536)).toBe('1.5 GB');
		expect(money(24)).toBe('$24');
		expect(money(24.5)).toBe('$24.50');
		expect(countryOf('blr1')).toBe('India');
		expect(countryOf('zzz9')).toBe('');
		const min = { vcpus: 2, memoryMb: 2048, diskGb: 40 };
		expect(cheapestAtLeast(CATALOG.sizes, ['v5shared'], 'blr1', min)?.slug).toBe('s5-2');
		expect(cheapestAtLeast(CATALOG.sizes, ['v5shared'], 'sgp1', min)).toBeUndefined();
	});
});

describe('DigitalOcean create: the steps', () => {
	it('reads the catalog, starts from the first non-production environment and names the DigitalOcean project', async () => {
		const { c, loaded } = make();
		await loaded();
		expect(c.readAt()).toBe('2026-11-20T10:00:00Z');
		expect(c.envs()).toEqual(['production', 'staging']);
		expect(c.draft().environment).toBe('staging');
		await vi.waitFor(() => expect(c.draft().projectId).toBe('do-proj-1'));
		expect(c.projectName()).toBe('Saha Textile');
		expect(c.domains()).toEqual(['staging.example.com']);
		c.patch({ projectId: 'nope' });
		expect(c.projectName()).toBe('the account default');
	});

	it('falls back to the default DigitalOcean project, and to staging when no environment runs on this account', async () => {
		const other = make({ projectName: 'Something else' });
		await other.loaded();
		await vi.waitFor(() => expect(other.c.draft().projectId).toBe('do-proj-2'));
		const none = make({ projectName: null, environments: [], cloud: false });
		expect(none.c.envs()).toEqual(['staging']);
		const prodOnly = make({ environments: [{ name: 'production', cloudId: 'do1', domains: [] }] });
		expect(prodOnly.c.draft().environment).toBe('production');
	});

	it('shows nothing for a catalog that could not be read', async () => {
		const { c, api } = make({ answer: { state: 'failed', message: 'down' } });
		await vi.waitFor(() => expect(api.doCatalog).toHaveBeenCalled());
		expect(c.catalog()).toBeNull();
		expect(c.readAt()).toBeNull();
		expect(c.problems()).toEqual([]);
		expect(c.regionVpcs()).toEqual([]);
		expect(c.imagesOf('os')).toEqual([]);
		expect(c.familyCount('regular')).toBe(0);
		expect(c.backupPlans()[1]?.note).toContain('$0');
	});

	it('names each step, moves between them, and starts a new draft for another environment', async () => {
		const { c, router, fixture } = make({ step: 'imageOpen' });
		expect(c.stepKey()).toBe('image');
		fixture.componentRef.setInput('step', 'confirm');
		expect(c.stepKey()).toBe('finalize');
		fixture.componentRef.setInput('step', 'nowhere');
		expect(c.stepKey()).toBe('nowhere');
		expect(c.stepIndex()).toBe(0);
		fixture.componentRef.setInput('step', DO_STEPS[DO_STEPS.length - 1]?.[0] as string);
		expect(c.nextLabel()).toBe('');
		c.next();
		expect(router.navigate).not.toHaveBeenCalled();
		c.back();
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParamsHandling: 'merge' }));
		fixture.componentRef.setInput('step', 'region');
		c.next();
		c.back();
		expect(router.navigate).toHaveBeenLastCalledWith([], {
			queryParams: { tab: 'list' },
			queryParamsHandling: 'merge',
		});
		c.toggleKey(1);
		c.useEnvironment('production');
		expect(c.draft().environment).toBe('production');
		expect(c.draft().sshKeyIds).toEqual([1]);
		expect(c.isProduction()).toBe(true);
	});

	it('picks a region, keeping the private network only where it lives', async () => {
		const { c, loaded } = make();
		await loaded();
		c.pickRegion(region('sgp1', false));
		expect(c.draft().region).not.toBe('sgp1');
		c.patch({ vpcId: 'vpc-own' });
		c.pickRegion(region('blr1'));
		expect(c.draft().vpcId).toBe('vpc-own');
		expect(c.regionVpcs()).toHaveLength(2);
		expect(c.defaultVpc()).toMatchObject({ id: 'vpc-default' });
		c.pickRegion(region('fra1'));
		expect(c.draft()).toMatchObject({ region: 'fra1', vpcId: null });
		c.pickRegion(region('blr1'));
	});

	it('groups operating systems in DigitalOcean’s order, newest first, with GPU images last; searches apps; picks images', async () => {
		const { c, loaded } = make();
		await loaded();
		const groups = c.osGroups().map((g) => g.name);
		expect(groups.slice(0, 2)).toEqual(['Ubuntu', 'Debian']);
		expect(groups).toContain('Ubuntu for GPU droplets');
		expect(groups.indexOf('Arch Linux')).toBeLessThan(groups.indexOf('Zeta'));
		expect(c.osGroups()[0]?.versions.map((v) => v.id)).toEqual([1, 3, 2]);
		expect(c.chosenOs()).toBeTruthy();
		c.appSearch.set('dock');
		expect(c.apps().map((a) => a.name)).toEqual(['Docker']);
		c.appSearch.set('');
		expect(c.apps().map((a) => a.name)).toEqual(['Docker', 'WordPress']);
		c.pickImage(undefined);
		const snapshot = c.imagesOf('snapshot')[0] as DoImage;
		c.pickImage(snapshot);
		expect(c.draft()).toMatchObject({ imageKind: 'snapshot', image: 20 });
		expect(c.isChosen(snapshot)).toBe(true);
		expect(c.chosenOs()).toBeUndefined();
		c.pickImage(c.imagesOf('app')[0]);
		expect(c.draft().image).toBe('wordpress');
	});

	it('picks CPU groups, families and sizes, offered here or not', async () => {
		const { c, loaded } = make();
		await loaded();
		expect(c.cpuGroup()).toBe('shared');
		expect(c.planSize()).toBe('s-2vcpu-4gb');
		expect(c.familySizes().map((s) => s.slug)).toEqual(['s-1vcpu-1gb', 's-2vcpu-4gb', 's-8vcpu-16gb']);
		c.pickGroup('dedicated');
		expect(c.draft()).toMatchObject({ sizeFamily: 'general', size: 'g-2vcpu-8gb' });
		expect(c.cpuGroup()).toBe('dedicated');
		expect(c.groupFamilies()).toContain('general');
		c.pickGroup('gpu');
		expect(c.draft()).toMatchObject({ sizeFamily: 'gpu', size: 'g-2vcpu-8gb' });
		expect(c.cpuGroup()).toBe('gpu');
		c.pickGroup('shared');
		expect(c.familyCount('regular')).toBe(2);
		c.pickSize(CATALOG.sizes[2] as DoSize);
		expect(c.draft().size).toBe('s-1vcpu-1gb');
		c.pickSize(CATALOG.sizes[0] as DoSize);
		expect(c.size()?.slug).toBe('s-2vcpu-4gb');
		expect(c.cost().total).toBeGreaterThan(0);
	});

	it('slides through real sizes only, by pointer and by arrow key', async () => {
		const { c, loaded } = make();
		await loaded();
		c.sliderGroup.set('shared');
		const [cpu] = c.sliders();
		expect(cpu?.values).toEqual([1, 2, 4]);
		c.slide('vcpus', pointer(100));
		expect(c.draft().size).toBe('s5-4');
		c.slideMove('vcpus', pointer(0, 0));
		expect(c.draft().size).toBe('s5-4');
		// The other two sliders stay at the chosen size's values until they move too.
		c.slideMove('vcpus', pointer(0));
		expect(c.draft().size).toBe('s5-4');
		c.slide('memoryMb', pointer(0));
		c.slide('diskGb', pointer(0));
		expect(c.draft().size).toBe('s5-1');
		c.slideKey('vcpus', key('ArrowRight'));
		expect(c.sliders()[0]?.index).toBe(1);
		c.slideKey('vcpus', key('Enter'));
		c.slideKey('nothing', key('ArrowLeft'));
		c.slide('nothing', pointer(50));
		expect(c.sliderPick()?.slug).toBe('s5-2');
		c.sliderGroup.set('dedicated');
		expect(c.sliders()[0]?.values).toEqual([2, 4]);
		c.slide('vcpus', pointer(100));
		expect(c.draft().size).toBe('g5-4');
		// No dedicated size has 4 vCPU and 8 GB at once: the size stays as it was.
		c.slide('memoryMb', pointer(100));
		expect(c.draft().size).toBe('g5-4');
	});

	it('words the backup plans from the size’s price, and keeps a volume within DigitalOcean’s limits', async () => {
		const { c, loaded } = make();
		await loaded();
		expect(c.backupPlans().map((p) => p.key)).toEqual(['off', 'weekly', 'daily']);
		c.setVolume('abc');
		expect(c.draft().volumeGb).toBe(0);
		c.setVolume('0');
		expect(c.draft().volumeGb).toBe(1);
		c.setVolume('99999');
		expect(c.draft().volumeGb).toBe(16384);
	});

	it('sets keys, quantity, names, tags and who may sign in, then checks and sends the create', async () => {
		const { c, api, router, loaded } = make();
		await loaded();
		c.toggleKey(1);
		c.toggleKey(1);
		expect(c.draft().sshKeyIds).toEqual([]);
		c.toggleKey(1);
		c.setQuantity('3');
		expect(c.draft().names).toHaveLength(3);
		c.setQuantity('x');
		expect(c.draft().quantity).toBe(1);
		c.setName('   ');
		c.setName('shop-staging');
		expect(c.draft().names).toEqual(['shop-staging']);
		const tag = input(' web ');
		c.addTag(tag);
		expect(tag.value).toBe('');
		c.addTag(input('web'));
		c.addTag(input(''));
		expect(c.draft().tags.filter((t) => t === 'web')).toHaveLength(1);
		c.removeTag('web');
		c.addEmail(input('not an email'));
		c.addEmail(input('B@Example.test'));
		c.addEmail(input('b@example.test'));
		expect(c.emails()).toEqual(['a@b.test', 'b@example.test']);
		c.removeEmail('a@b.test');
		expect(JSON.parse(c.requestText())).toMatchObject({ name: 'shop-staging' });
		expect(c.summary().map((row) => row[0])).toContain('Region');
		expect(c.confirmProblem()).toMatch(/Type staging to confirm/);
		c.typed.set('staging');
		expect(c.confirmProblem()).toMatch(/at least 12/);
		c.password.set('correct horse battery');
		c.password2.set('different');
		expect(c.confirmProblem()).toMatch(/differ/);
		c.password2.set('correct horse battery');
		c.removeEmail('b@example.test');
		expect(c.confirmProblem()).toMatch(/at least one person/);
		c.addEmail(input('b@example.test'));
		expect(c.confirmProblem()).toMatch(/PIN/);
		c.pin.set('123456');
		expect(c.confirmProblem()).toBe('');
		c.busy.set(true);
		await c.create();
		expect(api.createDroplet).not.toHaveBeenCalled();
		c.busy.set(false);
		await c.create();
		expect(router.navigate).toHaveBeenLastCalledWith([], {
			queryParams: { tab: 'creating', job: 'job-1' },
			queryParamsHandling: 'merge',
		});
		expect(c.password()).toBe('');
		c.password.set('correct horse battery');
		c.password2.set('correct horse battery');
		api.createDroplet.mockRejectedValueOnce(new Error('PIN refused'));
		await c.create();
		expect(c.message()).toBe('PIN refused');
		api.createDroplet.mockRejectedValueOnce('nothing');
		await c.create();
		expect(c.message()).toBe('The console API did not answer.');
	});

	it('shows the draft’s first problem before anything else', async () => {
		const { c, loaded } = make();
		await loaded();
		c.patch({ region: 'sgp1' });
		expect(c.problems().length).toBeGreaterThan(0);
		expect(c.confirmProblem()).toBe(c.problems()[0]);
	});
});

describe('DigitalOcean create: the step without its cloud slot', () => {
	it('asks nothing of DigitalOcean while the repository has no DigitalOcean cloud', () => {
		const { c, api } = make({ cloud: false });
		expect(api.doCatalog).not.toHaveBeenCalled();
		expect(c.catalog()).toBeNull();
	});
});

describe('DigitalOcean create: the rest', () => {
	it('words disks, and works without a project or repository id', async () => {
		const { c, api, loaded } = make({ ids: false, projectName: null });
		expect(c.disk(CATALOG.sizes[0] as DoSize)).toBe('SSD');
		expect(c.disk(CATALOG.sizes[3] as DoSize)).toBe('NVMe SSD');
		await loaded();
		expect(api.doCatalog).toHaveBeenCalledWith('', '', 'do1');
		expect(c.draft().names[0]).toMatch(/^project-/);
		await vi.waitFor(() => expect(c.draft().projectId).toBe('do-proj-2'));
		c.useEnvironment('production');
		expect(c.draft().names[0]).toMatch(/^project-/);
		c.typed.set('production');
		c.password.set('correct horse battery');
		c.password2.set('correct horse battery');
		c.pin.set('123456');
		c.toggleKey(1);
		c.patch({ region: 'blr1', size: 's-2vcpu-4gb', sizeFamily: 'regular' });
		// No project: nobody may sign in over SSH until someone is added here.
		c.addEmail(input('a@b.test'));
		expect(c.confirmProblem()).toBe('');
		await c.create();
		expect(api.createDroplet).toHaveBeenCalledWith('', '', 'do1', expect.anything());
	});

	it('sums up the chosen network, monitoring and first-boot file once those steps are reached', async () => {
		const { c, fixture, loaded } = make();
		await loaded();
		fixture.componentRef.setInput('step', DO_STEPS[DO_STEPS.length - 1]?.[0] as string);
		c.patch({ vpcId: 'vpc-own', ipv6: false, monitoring: false, firstBoot: false });
		const text = c
			.summary()
			.map((row) => row[1])
			.join(' | ');
		expect(text).toContain('own VPC');
		expect(text).toContain('IPv4');
		expect(text).not.toContain('IPv6');
		c.patch({ vpcId: null, ipv6: true, monitoring: true, firstBoot: true });
		expect(
			c
				.summary()
				.map((row) => row[1])
				.join(' | '),
		).toContain('first-boot file');
	});
});

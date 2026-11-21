/**
 * DigitalOcean › Droplets › create (Safe Releases Brief v7, screens-do.js): the live lists the seven
 * steps choose from, the choices themselves, the exact request the console sends and what it costs.
 * Lists and prices are read from DigitalOcean each time the steps open; nothing here is a price list.
 */
import { z } from 'zod';

import { vendorAnswer } from './projects.js';

/** How DigitalOcean groups sizes on its own create page, from the size's slug. */
export const SIZE_FAMILIES = [
	'regular',
	'amd',
	'intel',
	'v5shared',
	'v5general',
	'general',
	'cpu',
	'memory',
	'storage',
	'gpu',
	'other',
] as const;
export const sizeFamilySchema = z.enum(SIZE_FAMILIES);
export type SizeFamily = z.infer<typeof sizeFamilySchema>;

export const SIZE_FAMILY_NAMES: Record<SizeFamily, string> = {
	regular: 'Basic · Regular',
	amd: 'Basic · Premium AMD',
	intel: 'Basic · Premium Intel',
	v5shared: 'v5 Shared (build your own)',
	v5general: 'v5 General Purpose (build your own)',
	general: 'General Purpose',
	cpu: 'CPU-Optimized',
	memory: 'Memory-Optimized',
	storage: 'Storage-Optimized',
	gpu: 'GPU',
	other: 'Other',
};

/** Shared CPU (Basic) or dedicated CPU, as DigitalOcean splits them. */
export const SHARED_FAMILIES: readonly SizeFamily[] = ['regular', 'amd', 'intel'];
export const DEDICATED_FAMILIES: readonly SizeFamily[] = ['general', 'cpu', 'memory', 'storage'];
/** DigitalOcean's newer configuration: vCPU, memory and boot disk chosen apart (s5-, g5- sizes). */
export const V5_FAMILIES: readonly SizeFamily[] = ['v5shared', 'v5general'];

export function sizeFamily(slug: string): SizeFamily {
	if (/^gpu-/.test(slug)) return 'gpu';
	if (/^s5-/.test(slug)) return 'v5shared';
	if (/^g5-/.test(slug)) return 'v5general';
	if (/^s-.*-amd$/.test(slug)) return 'amd';
	if (/^s-.*-intel$/.test(slug)) return 'intel';
	if (/^s-/.test(slug)) return 'regular';
	if (/^gd?-/.test(slug)) return 'general';
	if (/^c2?-/.test(slug)) return 'cpu';
	if (/^m\d?-/.test(slug)) return 'memory';
	if (/^so(1_5)?-/.test(slug)) return 'storage';
	return 'other';
}

export const doRegionSchema = z.object({
	slug: z.string(),
	name: z.string(),
	available: z.boolean(),
	sizes: z.array(z.string()),
	features: z.array(z.string()),
});
export type DoRegion = z.infer<typeof doRegionSchema>;

export const doSizeSchema = z.object({
	slug: z.string(),
	description: z.string(),
	family: sizeFamilySchema,
	memoryMb: z.number(),
	vcpus: z.number(),
	diskGb: z.number(),
	transferTb: z.number(),
	priceMonthly: z.number(),
	priceHourly: z.number(),
	regions: z.array(z.string()),
	available: z.boolean(),
});
export type DoSize = z.infer<typeof doSizeSchema>;

/** The image tabs on DigitalOcean's create page. */
export const IMAGE_KINDS = ['os', 'app', 'custom', 'snapshot', 'backup'] as const;
export const imageKindSchema = z.enum(IMAGE_KINDS);
export type ImageKind = z.infer<typeof imageKindSchema>;
export const IMAGE_KIND_NAMES: Record<ImageKind, string> = {
	os: 'OS',
	app: 'Marketplace',
	custom: 'Custom images',
	snapshot: 'Snapshots',
	backup: 'Backups',
};

export const doImageSchema = z.object({
	id: z.number().int(),
	slug: z.string().nullable(),
	name: z.string(),
	distribution: z.string(),
	kind: imageKindSchema,
	regions: z.array(z.string()),
	minDiskGb: z.number(),
	sizeGb: z.number().nullable(),
	createdAt: z.string(),
	/** For a backup: the droplet it belongs to. */
	of: z.string().nullable(),
});
export type DoImage = z.infer<typeof doImageSchema>;

export const doSshKeySchema = z.object({ id: z.number().int(), name: z.string(), fingerprint: z.string() });
export type DoSshKey = z.infer<typeof doSshKeySchema>;

export const doVpcSchema = z.object({
	id: z.string(),
	name: z.string(),
	region: z.string(),
	ipRange: z.string(),
	isDefault: z.boolean(),
});
export type DoVpc = z.infer<typeof doVpcSchema>;

export const doProjectSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() });
export type DoProject = z.infer<typeof doProjectSchema>;

/** Everything the seven steps choose from, read together when they open. */
export const doCatalogSchema = z.object({
	regions: z.array(doRegionSchema),
	sizes: z.array(doSizeSchema),
	images: z.array(doImageSchema),
	sshKeys: z.array(doSshKeySchema),
	vpcs: z.array(doVpcSchema),
	projects: z.array(doProjectSchema),
	/** Lists DigitalOcean refused or could not answer, named so the step can say why it is empty. */
	missing: z.array(z.string()),
});
export type DoCatalog = z.infer<typeof doCatalogSchema>;
export const doCatalogAnswerSchema = vendorAnswer(doCatalogSchema);

export const BACKUP_PLANS = ['off', 'weekly', 'daily'] as const;
export type BackupPlan = (typeof BACKUP_PLANS)[number];
/** DigitalOcean's backup window: a weekday (weekly plan) and the 4-hour window's start hour, in UTC. */
export const BACKUP_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const BACKUP_HOURS = [0, 4, 8, 12, 16, 20] as const;
/** DigitalOcean's published backup prices, a share of the droplet's own price (not in its API). */
export const BACKUP_SHARE: Record<BackupPlan, number> = { off: 0, weekly: 0.2, daily: 0.3 };
/** DigitalOcean's published block storage price, per GiB a month (not in its API). */
export const VOLUME_PRICE_PER_GB = 0.1;

const dropletName = z.string().regex(/^[a-zA-Z0-9.-]{1,63}$/, 'Letters, digits, dots and hyphens only.');
const tagName = z.string().regex(/^[a-zA-Z0-9_:-]{1,255}$/, 'Letters, digits, _, : and - only.');

/** What the seven steps hold. */
export const dropletDraftSchema = z.object({
	environment: z.string().min(1),
	region: z.string().min(2),
	/** `null`: the region's default VPC. */
	vpcId: z.string().nullable(),
	imageKind: imageKindSchema,
	/** A slug for public images, a numeric id for snapshots, backups and custom images. */
	image: z.union([z.string().min(1), z.number().int()]),
	sizeFamily: sizeFamilySchema,
	size: z.string().min(1),
	volumeGb: z.number().int().min(0).max(16384),
	volumeFormat: z.enum(['ext4', 'xfs', 'none']),
	backups: z.enum(BACKUP_PLANS),
	backupWeekday: z.enum(BACKUP_WEEKDAYS),
	backupHour: z.union(BACKUP_HOURS.map((h) => z.literal(h)) as [z.ZodLiteral<0>, ...z.ZodLiteral<number>[]]),
	sshKeyIds: z.array(z.number().int()).max(20),
	ipv6: z.boolean(),
	monitoring: z.boolean(),
	agent: z.boolean(),
	firstBoot: z.boolean(),
	quantity: z.number().int().min(1).max(10),
	names: z.array(dropletName).min(1).max(10),
	tags: z.array(tagName).max(20),
	projectId: z.string().nullable(),
});
export type DropletDraft = z.infer<typeof dropletDraftSchema>;

/** One server per environment, as `pnpm server:create` makes it (scripts/server/servers.mjs). */
export const SERVER_REGION = 'blr1';
export const SERVER_IMAGE = 'ubuntu-26-04-x64';
export const SERVER_SIZES: Record<string, string> = {
	production: 's-4vcpu-8gb',
	staging: 's-2vcpu-4gb',
	development: 's-2vcpu-4gb',
};

/** The agreed setup for a project's environment server; every step starts from it. */
export function serverDraftOf(projectId: string, environment: string): DropletDraft {
	const name = `${projectId}-${environment}`;
	const size = SERVER_SIZES[environment] ?? SERVER_SIZES['staging'] ?? 's-2vcpu-4gb';
	return {
		environment,
		region: SERVER_REGION,
		vpcId: null,
		imageKind: 'os',
		image: SERVER_IMAGE,
		sizeFamily: sizeFamily(size),
		size,
		volumeGb: 0,
		volumeFormat: 'ext4',
		backups: 'off',
		backupWeekday: 'SUN',
		backupHour: 20,
		sshKeyIds: [],
		ipv6: true,
		monitoring: true,
		agent: true,
		firstBoot: true,
		quantity: 1,
		names: [name],
		tags: [projectId, name],
		projectId: null,
	};
}

/** The names for `quantity` droplets: the first name, then -2, -3 … */
export function namesFor(first: string, quantity: number): string[] {
	return Array.from({ length: quantity }, (_, n) => (n === 0 ? first : `${first}-${n + 1}`));
}

/** The first-boot file's place in the request: the Mac fills it in at create time, never the browser. */
export const FIRST_BOOT_MARK = '(docker/production/first-boot.yaml, filled in on this Mac when you create)';

/** POST /v2/droplets, exactly as the console sends it (the first-boot file shown by its mark). */
export function dropletRequestOf(d: DropletDraft): Record<string, unknown> {
	const body: Record<string, unknown> = d.quantity === 1 ? { name: d.names[0] } : { names: d.names };
	Object.assign(body, {
		region: d.region,
		size: d.size,
		image: d.image,
		ssh_keys: d.sshKeyIds,
		backups: d.backups !== 'off',
		ipv6: d.ipv6,
		monitoring: d.monitoring,
		with_droplet_agent: d.agent,
		tags: d.tags,
	});
	if (d.backups !== 'off')
		body['backup_policy'] =
			d.backups === 'weekly'
				? { plan: 'weekly', weekday: d.backupWeekday, hour: d.backupHour }
				: { plan: 'daily', hour: d.backupHour };
	if (d.vpcId) body['vpc_uuid'] = d.vpcId;
	if (d.volumeGb > 0) body['volumes'] = ['(the volume created just before)'];
	if (d.firstBoot) body['user_data'] = FIRST_BOOT_MARK;
	return body;
}

export interface DropletCost {
	droplet: number;
	backups: number;
	volume: number;
	/** One droplet with its extras, a month. */
	each: number;
	/** All of them, a month. */
	total: number;
	/** All droplets, an hour (droplet price only). */
	hourly: number;
}

export function dropletCost(d: DropletDraft, size: DoSize | undefined): DropletCost {
	const droplet = size?.priceMonthly ?? 0;
	const backups = droplet * BACKUP_SHARE[d.backups];
	const volume = d.volumeGb * VOLUME_PRICE_PER_GB;
	const each = droplet + backups + volume;
	return { droplet, backups, volume, each, total: each * d.quantity, hourly: (size?.priceHourly ?? 0) * d.quantity };
}

/** Why the draft cannot be created yet, in the order of the steps; empty when it can. */
export function draftProblems(d: DropletDraft, c: DoCatalog): string[] {
	const out: string[] = [];
	const region = c.regions.find((r) => r.slug === d.region);
	if (!region) out.push('Region: choose a region.');
	else if (!region.available) out.push(`Region: ${region.name} takes no new droplets right now.`);
	const image = c.images.find((i) => (typeof d.image === 'number' ? i.id === d.image : i.slug === d.image));
	if (!image) out.push('Image: choose an image.');
	else if (region && image.regions.length && !image.regions.includes(region.slug))
		out.push(`Image: ${image.distribution} ${image.name} is not in ${region.name}.`);
	const size = c.sizes.find((s) => s.slug === d.size);
	if (!size) out.push('Size: choose a size.');
	else {
		if (region && !size.regions.includes(region.slug))
			out.push(`Size: ${size.slug} is not offered in ${region.name}.`);
		if (image && size.diskGb < image.minDiskGb)
			out.push(
				`Size: the image needs at least ${image.minDiskGb} GB of disk; ${size.slug} has ${size.diskGb} GB.`,
			);
	}
	if (d.sshKeyIds.length === 0) out.push('Sign-in: pick at least one SSH key.');
	if (d.names.length !== d.quantity) out.push('Name: one name per droplet.');
	const parsed = dropletDraftSchema.safeParse(d);
	if (!parsed.success) for (const issue of parsed.error.issues) out.push(`${issue.path.join('.')}: ${issue.message}`);
	return out;
}

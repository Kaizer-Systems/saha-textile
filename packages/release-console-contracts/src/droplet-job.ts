/**
 * Creating and destroying a server from DigitalOcean › Droplets (brief v7: confirm, creating, ready,
 * destroy). The console API runs each step in order and the screen follows it; a failed step stops
 * the job and says why.
 */
import { z } from 'zod';

import { dropletDraftSchema } from './do-catalog.js';
import { vendorAnswer } from './projects.js';

const pin = z.string().regex(/^\d{6}$/);

export const startDropletCreateSchema = z.object({
	pin,
	/** The environment's name, typed by the owner. */
	confirm: z.string(),
	draft: dropletDraftSchema,
	/**
	 * The admin user's Recovery Console password: hashed on this Mac into the first-boot file and
	 * never kept. The owner keeps the password itself in NordPass.
	 */
	adminPassword: z
		.string()
		.min(12)
		.max(128)
		.regex(/^[^\r\n]+$/),
});
export type StartDropletCreate = z.infer<typeof startDropletCreateSchema>;

export const startDropletDestroySchema = z.object({
	pin,
	/** The droplet's name, typed by the owner. */
	confirm: z.string(),
	dropletId: z.number().int().positive(),
});
export type StartDropletDestroy = z.infer<typeof startDropletDestroySchema>;

export const jobStepStateSchema = z.enum(['queued', 'running', 'done', 'skipped', 'failed']);
export type JobStepState = z.infer<typeof jobStepStateSchema>;

export const dropletJobStepSchema = z.object({
	key: z.string(),
	label: z.string(),
	/** What was called and what came back, in words; never a value. */
	detail: z.string(),
	state: jobStepStateSchema,
	ms: z.number().int().nullable(),
});
export type DropletJobStep = z.infer<typeof dropletJobStepSchema>;

export const dropletJobSchema = z.object({
	id: z.string(),
	kind: z.enum(['create', 'destroy']),
	environment: z.string(),
	name: z.string(),
	state: z.enum(['running', 'done', 'failed']),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	steps: z.array(dropletJobStepSchema),
	dropletId: z.number().int().nullable(),
	ipv4: z.string().nullable(),
	ipv6: z.string().nullable(),
	privateIp: z.string().nullable(),
	monthly: z.number(),
	hourly: z.number(),
	error: z.string().nullable(),
});
export type DropletJob = z.infer<typeof dropletJobSchema>;
export const dropletJobAnswerSchema = vendorAnswer(dropletJobSchema);
export const dropletJobsSchema = z.array(dropletJobSchema);

/** The create steps in order, as the Creating tab lists them before they run. */
export const CREATE_STEPS: readonly (readonly [string, string])[] = [
	['tunnel', 'Cloudflare tunnel for the server'],
	['first-boot', 'First-boot file filled in on this Mac'],
	['volume', 'Block storage volume'],
	['droplet', 'Request accepted by DigitalOcean'],
	['active', 'Server built and switched on'],
	['addresses', 'Addresses assigned'],
	['project', 'Moved into the DigitalOcean project'],
	['firewall', 'Cloud Firewall attached'],
	['dns', 'DNS records at Cloudflare'],
	['tunnel-up', 'First boot done: the tunnel is up'],
];

/** The destroy steps, the create in reverse. Production is never destroyed from the console. */
export const DESTROY_STEPS: readonly (readonly [string, string])[] = [
	['dns', 'DNS records at Cloudflare removed'],
	['firewall', 'Cloud Firewall deleted'],
	['droplet', 'Droplet destroyed'],
	['tunnel', 'Cloudflare tunnel deleted'],
];

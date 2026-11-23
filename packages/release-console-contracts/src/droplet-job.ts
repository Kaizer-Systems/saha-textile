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
	/** Who may sign in over SSH through Access (owner, 21 Nov: a list, more added later). */
	sshEmails: z.array(z.string().email().max(254)).min(1).max(50),
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

/** Changes the project's SSH list; the servers' Access rules follow. */
export const setSshEmailsSchema = z.object({
	pin,
	emails: z.array(z.string().email().max(254)).min(1).max(50),
});
export type SetSshEmails = z.infer<typeof setSshEmailsSchema>;
export const sshListAnswerSchema = z.object({ emails: z.array(z.string()), hosts: z.array(z.string()) });

/**
 * Which environment a cloud resource belongs to (owner, 23 Nov): resource key → one of the repository's
 * own environment names, kept in the console's file. Keys: `do:droplet:<id>`, `do:database:<id>`,
 * `do:spaces:<bucket>`, `do:k8s:<id>`, `do:app:<id>`.
 */
export const envTagKeySchema = z.string().regex(/^do:(droplet|database|spaces|k8s|app):[\w.-]{1,80}$/);
export const envTagsSchema = z.record(z.string(), z.string());
export type EnvTags = z.infer<typeof envTagsSchema>;
/** Sets or clears (env null) one resource's environment, after the PIN. */
export const setEnvTagSchema = z.object({
	pin,
	key: envTagKeySchema,
	env: z.string().min(1).max(40).nullable(),
});
export type SetEnvTag = z.infer<typeof setEnvTagSchema>;

/** The SSH host name a server gets through its tunnel: `ssh-<environment>.<zone>`. */
export const sshHostOf = (environment: string, zone: string): string => `ssh-${environment}.${zone}`;

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
	/** The SSH host through the tunnel (browser terminal and cloudflared). */
	sshHost: z.string().nullable().default(null),
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
	['ssh-host', 'SSH host name through the tunnel'],
	['access', 'Cloudflare Access: the deploy job and the people on the list'],
	['certificates', 'Origin Certificate and origin-pulls certificate, kept in Infisical'],
	['first-boot', 'First-boot file filled in on this machine'],
	['volume', 'Block storage volume'],
	['droplet', 'Request accepted by DigitalOcean'],
	['active', 'Server built and switched on'],
	['addresses', 'Addresses assigned'],
	['project', 'Moved into the DigitalOcean project'],
	['firewall', 'Cloud Firewall attached'],
	['dns', 'DNS records at Cloudflare'],
	['origin-pulls', 'Authenticated Origin Pulls on the environment’s hosts'],
	['tunnel-up', 'First boot done: the tunnel is up'],
	['private-access', 'WARP: the server’s private address for the people on the list'],
	['github', 'GitHub environment: variables and secrets'],
	['known-hosts', 'The server’s SSH host key, read through the tunnel'],
];

/** The destroy steps, the create in reverse. Production is never destroyed from the console. */
export const DESTROY_STEPS: readonly (readonly [string, string])[] = [
	['dns', 'DNS records at Cloudflare removed'],
	['origin-pulls', 'Authenticated Origin Pulls turned off on its hosts'],
	['firewall', 'Cloud Firewall deleted'],
	['droplet', 'Droplet destroyed'],
	['access', 'Access application and deploy token deleted'],
	['tunnel', 'Cloudflare tunnel and its SSH host name deleted'],
];

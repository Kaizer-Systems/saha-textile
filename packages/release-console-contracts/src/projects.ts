/**
 * Projects, repositories and their vendor slots (Release Console Projects brief, approved 10 Nov
 * 2026). The console file on the owner's computer holds only these shapes; key values live in the
 * macOS Keychain and never appear in any answer.
 */
import { z } from 'zod';

const slug = z
	.string()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');

/** Source-code vendors. Exactly one per repository. */
export const sourceCodeVendorSchema = z.enum(['github', 'gitlab', 'bitbucket', 'azure-repos']);
export type SourceCodeVendor = z.infer<typeof sourceCodeVendorSchema>;
/** Cloud platforms. One or more per repository. */
export const cloudVendorSchema = z.enum(['digitalocean', 'aws', 'gcp', 'azure']);
export type CloudVendor = z.infer<typeof cloudVendorSchema>;
/** Edge, DNS and security platforms. One or more per repository; each domain belongs to one. */
export const edgeVendorSchema = z.enum(['cloudflare', 'cloudfront', 'fastly']);
export type EdgeVendor = z.infer<typeof edgeVendorSchema>;
export type Vendor = SourceCodeVendor | CloudVendor | EdgeVendor;

/** Vendors whose screens are built. Every other vendor can be chosen and shows “screens later”. */
export const VENDORS_WITH_SCREENS: readonly Vendor[] = ['github', 'digitalocean', 'cloudflare'];
export const vendorScreens = (vendor: Vendor): 'full' | 'later' =>
	VENDORS_WITH_SCREENS.includes(vendor) ? 'full' : 'later';

export const VENDOR_NAMES: Record<Vendor, string> = {
	github: 'GitHub',
	gitlab: 'GitLab',
	bitbucket: 'Bitbucket',
	'azure-repos': 'Azure Repos',
	digitalocean: 'DigitalOcean',
	aws: 'AWS',
	gcp: 'Google Cloud',
	azure: 'Azure',
	cloudflare: 'Cloudflare',
	cloudfront: 'AWS CloudFront + Route 53',
	fastly: 'Fastly',
};

/**
 * What a stored key is for. `github-cli` stores nothing: it uses the GitHub CLI's own sign-in on
 * this computer, which was made in the browser.
 */
export const keyKindSchema = z.enum([
	'github-cli',
	'github-token',
	'do-read',
	'do-change',
	'spaces-key',
	'cf-read',
	'cf-change',
	'service-key',
]);
export type KeyKind = z.infer<typeof keyKindSchema>;

export interface KeyKindInfo {
	label: string;
	vendor: Vendor | null;
	/** `false` for a sign-in kept by another tool; nothing goes into the Keychain. */
	stored: boolean;
	/** Which slot of a repository the key serves. */
	slot: 'source-code' | 'cloud' | 'edge' | null;
	/** Where the owner makes the key; the console never makes one. */
	howTo: string;
}

export const KEY_KINDS: Record<KeyKind, KeyKindInfo> = {
	'github-cli': {
		label: 'GitHub CLI sign-in on this computer',
		vendor: 'github',
		stored: false,
		slot: 'source-code',
		howTo: 'Sign in once with `gh auth login` in a terminal; the browser finishes the sign-in. Nothing is pasted here.',
	},
	'github-token': {
		label: 'GitHub fine-grained token',
		vendor: 'github',
		stored: true,
		slot: 'source-code',
		howTo: 'GitHub › Settings › Developer settings › Fine-grained tokens, limited to this repository, read-only.',
	},
	'do-read': {
		label: 'DigitalOcean API · read',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		howTo: 'DigitalOcean › API › Tokens › Generate New Token, read scopes only, with an expiry.',
	},
	'do-change': {
		label: 'DigitalOcean API · change',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		howTo: 'DigitalOcean › API › Tokens › Generate New Token, custom scopes for the changes the console makes.',
	},
	'spaces-key': {
		label: 'DigitalOcean Spaces key',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		howTo: 'DigitalOcean › Spaces Object Storage › Access Keys, limited to the shop bucket.',
	},
	'cf-read': {
		label: 'Cloudflare API · read',
		vendor: 'cloudflare',
		stored: true,
		slot: 'edge',
		howTo: 'Cloudflare (the account that holds the domain) › Manage account › API Tokens, read permissions for the zone.',
	},
	'cf-change': {
		label: 'Cloudflare API · change',
		vendor: 'cloudflare',
		stored: true,
		slot: 'edge',
		howTo: 'Cloudflare (the account that holds the domain) › Manage account › API Tokens, edit permissions for the zone.',
	},
	'service-key': {
		label: 'Service key',
		vendor: null,
		stored: true,
		slot: null,
		howTo: 'Made in the service’s own dashboard, with the narrowest rights it offers.',
	},
};

/** A pasted key: printable characters only, no spaces or quotes, so it can never break the Keychain call. */
export const keyValueSchema = z
	.string()
	.max(4000)
	.regex(/^[\x21\x23-\x5b\x5d-\x7e]*$/, 'printable characters without spaces, quotes or backslashes');

export const keyStateSchema = z.enum(['unchecked', 'verified', 'failed', 'expiring', 'expired']);
export type KeyState = z.infer<typeof keyStateSchema>;

/** A reference to one key. The value itself is only in the Keychain item `keychainItem`. */
export const keyRefSchema = z.object({
	id: slug,
	kind: keyKindSchema,
	label: z.string().min(1).max(80),
	/** The Keychain account name; empty for a sign-in kept by another tool (`github-cli`). */
	keychainItem: z.string(),
	account: z.string().max(120).default(''),
	rights: z.array(z.string()).default([]),
	expiresAt: z.string().datetime().nullable().default(null),
	checkedAt: z.string().datetime().nullable().default(null),
	state: keyStateSchema.default('unchecked'),
	note: z.string().max(300).default(''),
});
export type KeyRef = z.infer<typeof keyRefSchema>;

export const sourceCodeSlotSchema = z.object({
	vendor: sourceCodeVendorSchema,
	/** Owner and name as the vendor writes it, e.g. `Kaizer-Systems/saha-textile`. */
	repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name'),
	keyId: slug.nullable().default(null),
});
export type SourceCodeSlot = z.infer<typeof sourceCodeSlotSchema>;

export const cloudSlotSchema = z.object({
	id: slug,
	vendor: cloudVendorSchema,
	account: z.string().max(120).default(''),
	keyIds: z.array(slug).default([]),
});
export type CloudSlot = z.infer<typeof cloudSlotSchema>;

export const edgeSlotSchema = z.object({
	id: slug,
	vendor: edgeVendorSchema,
	account: z.string().max(120).default(''),
	zones: z.array(z.string().min(3)).default([]),
	keyIds: z.array(slug).default([]),
});
export type EdgeSlot = z.infer<typeof edgeSlotSchema>;

export const environmentSchema = z.object({
	name: slug,
	label: z.string().min(1).max(40),
	/** Which of the repository's clouds it runs on; `null` means this computer. */
	cloudId: slug.nullable().default(null),
	domains: z.array(z.string()).default([]),
});
export type Environment = z.infer<typeof environmentSchema>;

export const repositorySchema = z.object({
	id: slug,
	name: z.string().min(1).max(80),
	role: z.string().max(120).default(''),
	sourceCode: sourceCodeSlotSchema,
	environments: z.array(environmentSchema).min(1),
	cloud: z.array(cloudSlotSchema).default([]),
	edge: z.array(edgeSlotSchema).default([]),
	/** The repository's own menu screens, from its `.release-console.json`. */
	menus: z.array(z.string()).default([]),
});
export type Repository = z.infer<typeof repositorySchema>;

/** Project names become Keychain account names, so they keep to plain characters. */
export const projectNameSchema = z
	.string()
	.min(1)
	.max(80)
	.regex(/^[\p{L}\p{N} &().,'_-]+$/u, "letters, digits, spaces and & ( ) . , ' _ -");

export const projectSchema = z.object({
	id: slug,
	name: projectNameSchema,
	workspace: z.string().min(1).max(60),
	repositories: z.array(repositorySchema).min(1),
	keys: z.array(keyRefSchema).default([]),
	createdAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;

/** A project as the Add-a-project wizard sends it: no keys or dates yet. */
export const newProjectSchema = projectSchema.omit({ keys: true, createdAt: true });
export type NewProject = z.infer<typeof newProjectSchema>;

/** `.release-console.json` at a repository's root. */
export const repositoryFileSchema = z.object({
	project: newProjectSchema.optional(),
	menus: z.array(z.string()).default([]),
});
export type RepositoryFile = z.infer<typeof repositoryFileSchema>;

export const consoleViewSchema = z.object({
	workspaces: z.array(z.string()),
	projects: z.array(projectSchema),
});
export type ConsoleView = z.infer<typeof consoleViewSchema>;

/** Storing a key: the value travels once, to the local API, and is never sent back. */
export const storeKeySchema = z.object({
	id: slug,
	kind: keyKindSchema,
	label: z.string().min(1).max(80),
	value: keyValueSchema.default(''),
	expiresAt: z.string().datetime().nullable().default(null),
	note: z.string().max(300).default(''),
});
export type StoreKey = z.infer<typeof storeKeySchema>;

/** Which keys a repository's slot uses. */
export const slotKeysSchema = z.object({
	repositoryId: slug,
	slot: z.enum(['source-code', 'cloud', 'edge']),
	slotId: z.string().default(''),
	keyIds: z.array(slug),
});
export type SlotKeys = z.infer<typeof slotKeysSchema>;

/* ----- lock ----- */

export const pinSchema = z.object({ pin: z.string().regex(/^\d{6}$/, '6 digits') });
export const changePinSchema = z.object({
	current: z.string().regex(/^\d{6}$/),
	next: z.string().regex(/^\d{6}$/),
});
export const lockStatusSchema = z.object({
	pinSet: z.boolean(),
	unlocked: z.boolean(),
	lockedUntil: z.string().datetime().nullable(),
	triesLeft: z.number().int().nonnegative(),
});
export type LockStatus = z.infer<typeof lockStatusSchema>;
export const unlockAnswerSchema = z.object({ session: z.string().min(32) });
export type UnlockAnswer = z.infer<typeof unlockAnswerSchema>;
export const okAnswerSchema = z.object({ ok: z.literal(true) });

/* ----- audit and Attention ----- */

export const auditEntrySchema = z.object({
	at: z.string().datetime(),
	projectId: z.string().nullable(),
	action: z.string(),
	detail: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const attentionItemSchema = z.object({
	projectId: z.string(),
	repositoryId: z.string().nullable(),
	kind: z.enum(['key-expiring', 'key-expired', 'key-failed', 'key-missing', 'ci-failed', 'approval-waiting']),
	title: z.string(),
	detail: z.string(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;
/** The console level shows names and counts only, never project data. */
export const attentionCountSchema = z.object({ projectId: z.string(), name: z.string(), count: z.number().int() });
export type AttentionCount = z.infer<typeof attentionCountSchema>;
export const attentionCountsSchema = z.array(attentionCountSchema);
export const attentionItemsSchema = z.array(attentionItemSchema);
export const auditEntriesSchema = z.array(auditEntrySchema);

/* ----- vendor data ----- */

/** Every vendor read answers one of three ways, so a screen can say why it has no data. */
export const vendorAnswer = <T extends z.ZodType>(data: T) =>
	z.discriminatedUnion('state', [
		z.object({ state: z.literal('ok'), readAt: z.string().datetime(), data }),
		z.object({ state: z.literal('not-connected'), message: z.string() }),
		z.object({ state: z.literal('error'), message: z.string() }),
	]);
export type VendorAnswer<T> =
	| { state: 'ok'; readAt: string; data: T }
	| { state: 'not-connected'; message: string }
	| { state: 'error'; message: string };

export const pullRequestSchema = z.object({
	number: z.number().int(),
	title: z.string(),
	author: z.string(),
	branch: z.string(),
	base: z.string(),
	draft: z.boolean(),
	updatedAt: z.string(),
	url: z.string().url(),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const workflowRunSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	branch: z.string(),
	event: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	url: z.string().url(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const dropletSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	status: z.string(),
	region: z.string(),
	size: z.string(),
	vcpus: z.number(),
	memoryMb: z.number(),
	diskGb: z.number(),
	ipv4: z.string().nullable(),
	tags: z.array(z.string()),
	createdAt: z.string(),
});
export type Droplet = z.infer<typeof dropletSchema>;

export const cloudAccountSchema = z.object({
	team: z.string(),
	status: z.string(),
	dropletLimit: z.number().int(),
	monthToDateUsage: z.string().nullable(),
	accountBalance: z.string().nullable(),
});
export type CloudAccount = z.infer<typeof cloudAccountSchema>;

export const edgeZoneSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	plan: z.string(),
	account: z.string(),
});
export type EdgeZone = z.infer<typeof edgeZoneSchema>;

export const dnsRecordSchema = z.object({
	id: z.string(),
	type: z.string(),
	name: z.string(),
	content: z.string(),
	proxied: z.boolean().nullable(),
	ttl: z.number(),
});
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

export const pullRequestsAnswerSchema = vendorAnswer(z.array(pullRequestSchema));
export const workflowRunsAnswerSchema = vendorAnswer(z.array(workflowRunSchema));
export const dropletsAnswerSchema = vendorAnswer(z.array(dropletSchema));
export const cloudAccountAnswerSchema = vendorAnswer(cloudAccountSchema);
export const edgeZonesAnswerSchema = vendorAnswer(z.array(edgeZoneSchema));
export const dnsRecordsAnswerSchema = vendorAnswer(z.array(dnsRecordSchema));

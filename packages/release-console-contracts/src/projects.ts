/**
 * Projects, repositories and their vendor slots (Release Console Projects brief, approved 10 Nov
 * 2026). The console's own store holds only these shapes. Key values live in Infisical; the console
 * reads them from its key file (written from Infisical with the owner's login) and never returns one.
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
/**
 * Secrets managers. One or more per repository; each environment reads its secrets from one of
 * them. Managed services, self-hosted servers and the source-code vendor's own store all count.
 */
export const secretsVendorSchema = z.enum([
	'infisical',
	'infisical-self-hosted',
	'aws-secrets-manager',
	'gcp-secret-manager',
	'azure-key-vault',
	'doppler',
	'vault',
	'github-secrets',
	'server-files',
]);
export type SecretsVendor = z.infer<typeof secretsVendorSchema>;
export type Vendor = SourceCodeVendor | CloudVendor | EdgeVendor | SecretsVendor;

/** How each secrets manager is run: by its vendor, by the owner, or inside the source-code vendor. */
export const SECRETS_HOSTING: Record<SecretsVendor, 'managed' | 'self-hosted' | 'source-code'> = {
	infisical: 'managed',
	'infisical-self-hosted': 'self-hosted',
	'aws-secrets-manager': 'managed',
	'gcp-secret-manager': 'managed',
	'azure-key-vault': 'managed',
	doppler: 'managed',
	vault: 'self-hosted',
	'github-secrets': 'source-code',
	'server-files': 'self-hosted',
};

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
	infisical: 'Infisical Cloud',
	'infisical-self-hosted': 'Infisical (self-hosted)',
	'aws-secrets-manager': 'AWS Secrets Manager',
	'gcp-secret-manager': 'Google Secret Manager',
	'azure-key-vault': 'Azure Key Vault',
	doppler: 'Doppler',
	vault: 'HashiCorp Vault or OpenBao',
	'github-secrets': 'GitHub Actions secrets',
	'server-files': 'Files on the server',
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

/** An Infisical variable name: capitals, digits and underscores. */
export const envNameSchema = z
	.string()
	.min(2)
	.max(80)
	.regex(/^[A-Z][A-Z0-9_]*$/, 'capitals, digits and underscores, starting with a letter');

/** Where the console's keys live in Infisical (owner decision, 20 Nov 2026): one folder, dev project only. */
export const CONSOLE_KEYS_FOLDER = 'saha-textile-dev · dev · /release-console';

export interface KeyKindInfo {
	label: string;
	vendor: Vendor | null;
	/** `false` for a sign-in kept by another tool (the GitHub CLI); no Infisical name is read. */
	stored: boolean;
	/** Which slot of a repository the key serves. */
	slot: 'source-code' | 'cloud' | 'edge' | 'secrets' | null;
	/** The Infisical names the key is read from; a Spaces key has two (access key, then secret). */
	envNames: string[];
	/** Where the owner makes the key; the console never makes one. */
	howTo: string;
}

export const KEY_KINDS: Record<KeyKind, KeyKindInfo> = {
	'github-cli': {
		label: 'GitHub CLI sign-in on this computer',
		vendor: 'github',
		stored: false,
		slot: 'source-code',
		envNames: [],
		howTo: 'Works only when the console runs outside Docker: sign in once with `gh auth login`. Inside Docker, link a GitHub token.',
	},
	'github-token': {
		label: 'GitHub fine-grained token',
		vendor: 'github',
		stored: true,
		slot: 'source-code',
		envNames: ['CONSOLE_GITHUB_TOKEN'],
		howTo: 'GitHub › Settings › Developer settings › Fine-grained tokens: owner Kaizer-Systems, this repository only; Actions read and write, Contents, Pull requests, Deployments, Environments, Commit statuses and Secrets read-only.',
	},
	'do-read': {
		label: 'DigitalOcean API · read',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		envNames: ['CONSOLE_DO_READ_TOKEN'],
		howTo: 'DigitalOcean › API › Tokens › Generate New Token: Read Only, with an expiry.',
	},
	'do-change': {
		label: 'DigitalOcean API · change',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		envNames: ['CONSOLE_DO_WRITE_TOKEN'],
		howTo: 'DigitalOcean › API › Tokens › Generate New Token: custom scopes for the changes the console makes, with an expiry.',
	},
	'spaces-key': {
		label: 'DigitalOcean Spaces key',
		vendor: 'digitalocean',
		stored: true,
		slot: 'cloud',
		envNames: ['CONSOLE_SPACES_ACCESS_KEY', 'CONSOLE_SPACES_SECRET_KEY'],
		howTo: 'DigitalOcean › Spaces Object Storage › Access Keys: Limited Access, the shop bucket, Read.',
	},
	'cf-read': {
		label: 'Cloudflare API · read',
		vendor: 'cloudflare',
		stored: true,
		slot: 'edge',
		envNames: ['CONSOLE_CF_READ_TOKEN'],
		howTo: 'Cloudflare (the account that holds the domain) › Manage account › Account API Tokens: zone read permissions for the domain only.',
	},
	'cf-change': {
		label: 'Cloudflare API · change',
		vendor: 'cloudflare',
		stored: true,
		slot: 'edge',
		envNames: ['CONSOLE_CF_WRITE_TOKEN'],
		howTo: 'Cloudflare (the account that holds the domain) › Manage account › Account API Tokens: the edit permissions the console uses, for the domain only.',
	},
	'service-key': {
		label: 'Service key',
		vendor: null,
		stored: true,
		slot: null,
		envNames: [],
		howTo: 'Made in the service’s own dashboard, with the narrowest rights it offers; saved in Infisical under a name you choose.',
	},
};

export const keyStateSchema = z.enum(['unchecked', 'verified', 'failed', 'expiring', 'expired']);
export type KeyState = z.infer<typeof keyStateSchema>;

/** A reference to one key: the Infisical names its value is read from. The value is never stored here. */
export const keyRefSchema = z.object({
	id: slug,
	kind: keyKindSchema,
	label: z.string().min(1).max(80),
	/** The Keychain account name; empty for a sign-in kept by another tool (`github-cli`). */
	/** Infisical names; empty for the GitHub CLI sign-in. */
	envNames: z.array(envNameSchema).max(2).default([]),
	account: z.string().max(120).default(''),
	rights: z.array(z.string()).default([]),
	expiresAt: z.string().datetime().nullable().default(null),
	checkedAt: z.string().datetime().nullable().default(null),
	state: keyStateSchema.default('unchecked'),
	note: z.string().max(300).default(''),
	/** What the key reaches inside the vendor: `region/bucket` for a Spaces key (e.g. `sgp1/saha-textile-media`). */
	target: z
		.string()
		.max(120)
		.regex(/^([a-z0-9-]+\/[a-z0-9.-]+)?$/, 'region/bucket')
		.default(''),
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

export const secretsSlotSchema = z.object({
	id: slug,
	vendor: secretsVendorSchema,
	/** The server's address for a self-hosted manager, e.g. `https://vault.example.com`; empty when managed. */
	address: z.union([z.literal(''), z.string().url().max(200)]).default(''),
	keyIds: z.array(slug).default([]),
});
export type SecretsSlot = z.infer<typeof secretsSlotSchema>;

export const environmentSchema = z.object({
	name: slug,
	label: z.string().min(1).max(40),
	/** Which of the repository's clouds it runs on; `null` means this computer. */
	cloudId: slug.nullable().default(null),
	domains: z.array(z.string()).default([]),
	/** Which of the repository's secrets managers it reads; `null` means files kept by hand. */
	secretsId: slug.nullable().default(null),
	/** Where its secrets sit inside that manager, e.g. `saha-textile-dev · dev · /api`. */
	secretsPath: z.string().max(200).default(''),
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
	secrets: z.array(secretsSlotSchema).default([]),
	/** The repository's own menu screens, from its `.release-console.json`. */
	menus: z.array(z.string()).default([]),
});
export type Repository = z.infer<typeof repositorySchema>;

/** Project names keep to plain characters; they appear in audit lines and file names. */
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

/**
 * `.release-console.json` at a repository's root: the repository's own menus. The Add-a-project
 * wizard reads it to tick those menus; it never adds a project by itself.
 */
export const repositoryFileSchema = z.object({ menus: z.array(z.string()).default([]) });
export type RepositoryFile = z.infer<typeof repositoryFileSchema>;

export const consoleViewSchema = z.object({
	workspaces: z.array(z.string()),
	projects: z.array(projectSchema),
});
export type ConsoleView = z.infer<typeof consoleViewSchema>;

/** Linking a key: which Infisical names hold it. No value travels; the console reads it from its key file. */
export const linkKeySchema = z.object({
	id: slug,
	kind: keyKindSchema,
	label: z.string().min(1).max(80),
	envNames: z.array(envNameSchema).max(2).default([]),
	expiresAt: z.string().datetime().nullable().default(null),
	note: z.string().max(300).default(''),
	/** What the key reaches inside the vendor: `region/bucket` for a Spaces key (e.g. `sgp1/saha-textile-media`). */
	target: z
		.string()
		.max(120)
		.regex(/^([a-z0-9-]+\/[a-z0-9.-]+)?$/, 'region/bucket')
		.default(''),
});
export type LinkKey = z.infer<typeof linkKeySchema>;

/** Which keys a repository's slot uses. */
export const slotKeysSchema = z.object({
	repositoryId: slug,
	slot: z.enum(['source-code', 'cloud', 'edge', 'secrets']),
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
/** How the lock screen opens first; both work whenever a password is set. */
export const signInMethodSchema = z.enum(['pin', 'password']);
export type SignInMethod = z.infer<typeof signInMethodSchema>;
/** A console password: 12 to 200 characters. */
export const consolePasswordSchema = z.string().min(12, 'at least 12 characters').max(200);
/** Unlocking with the PIN or the password. */
export const unlockSchema = z.union([
	pinSchema,
	z.object({ password: z.string().min(1).max(200) }),
]);
export type Unlock = z.infer<typeof unlockSchema>;
/** Setting or changing the password, or removing it, always needs the PIN. */
export const setPasswordSchema = z.object({ pin: pinSchema.shape.pin, password: consolePasswordSchema });
export const removePasswordSchema = z.object({ pin: pinSchema.shape.pin });
export const preferredMethodSchema = z.object({ pin: pinSchema.shape.pin, method: signInMethodSchema });
export const lockStatusSchema = z.object({
	pinSet: z.boolean(),
	passwordSet: z.boolean(),
	preferred: signInMethodSchema,
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

/** A repository's `.release-console.json` as read from its source-code vendor before it is added. */
export const repositoryFileQuerySchema = z.object({
	vendor: sourceCodeVendorSchema,
	repository: sourceCodeSlotSchema.shape.repository,
});
export type RepositoryFileQuery = z.infer<typeof repositoryFileQuerySchema>;
export const repositoryFileFoundSchema = z.object({ found: z.boolean(), menus: z.array(z.string()) });
export type RepositoryFileFound = z.infer<typeof repositoryFileFoundSchema>;
export const repositoryFileAnswerSchema = vendorAnswer(repositoryFileFoundSchema);

/** What the console's key file holds: names and when it was read, never values. */
export const keySourceSchema = z.object({
	file: z.string(),
	present: z.boolean(),
	readAt: z.string().datetime().nullable(),
	names: z.array(z.string()),
	/** Names the console reads that the file lacks; the optional ones are listed apart. */
	missing: z.array(z.string()),
	optionalBlank: z.array(z.string()),
	folder: z.string(),
});
export type KeySource = z.infer<typeof keySourceSchema>;

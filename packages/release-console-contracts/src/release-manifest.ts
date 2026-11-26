import { z } from 'zod';

/**
 * `.release-console.json`, version 2 (brief 26gq3NbcbBESea6abRtsa3, approved 20 Nov "Yes, as
 * recommended"): a repository describes itself to the Release Console. Each top-level key turns on
 * screens; a key left out leaves that screen off. Version 1 (`{"menus": [...]}`) still reads.
 * Never a secret here: keys stay in Infisical; the file names places, addresses and commands only.
 */

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes');
const path = z
	.string()
	.min(1)
	.max(300)
	.refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'a path inside the repository');
const urlPath = z.string().regex(/^\/[^\s]*$/, 'an address path starting with /');
/** A command the Mac helper may run: `pnpm <script>` from the repository root, nothing else. */
export const MANIFEST_COMMAND = /^pnpm [a-z0-9][a-z0-9:-]*( -- [a-z0-9 =:,./-]*)?$/;
const command = z.string().regex(MANIFEST_COMMAND, 'pnpm <script> from the repository root');

export const PART_KINDS = ['app', 'worker', 'database', 'cache', 'search', 'edge', 'queue', 'storage'] as const;
export const partSchema = z.object({
	id,
	kind: z.enum(PART_KINDS),
	/** What it is built with, for its logo: nestjs, analog, angular, mongodb, redis, meilisearch, nginx, bullmq… */
	tech: z.string().regex(/^[a-z0-9-]{1,40}$/),
	/** Its service name in the stack's compose file, which joins it to its container. */
	service: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
	/** Which of the environment's domains it answers on (`api`, `shop`, `admin`); none for inner parts. */
	host: z
		.string()
		.regex(/^[a-z0-9-]{1,30}$/)
		.optional(),
	health: urlPath.optional(),
	/** The API's read-only operations address (brief Q1 A), for parts that offer one. */
	ops: urlPath.optional(),
	logs: z.enum(['json', 'text', 'edge-json']).optional(),
	log: z.enum(['edge-json']).optional(),
	pwa: z.boolean().optional(),
	/** The request header that carries the client's build (Client versions). */
	buildHeader: z
		.string()
		.regex(/^x-[a-z0-9-]{1,40}$/)
		.optional(),
});
export type ManifestPart = z.infer<typeof partSchema>;

export const releaseManifestSchema = z
	.object({
		version: z.literal(2),
		product: z.object({
			name: z.string().min(1).max(60),
			kind: z.enum(['shop', 'api', 'site', 'worker', 'docs', 'other']),
		}),
		parts: z.array(partSchema).max(40).default([]),
		commands: z
			.object({
				localPipeline: command,
				stackEnv: command,
				stackUp: command,
				stackDown: command,
				stackStatus: command,
			})
			.partial()
			.default({}),
		deploy: z.object({ workflow: path, images: path, ci: path, migrations: path }).partial().optional(),
		secrets: z.object({ nameList: path }).optional(),
		payments: z
			.object({
				gateways: z.array(z.enum(['ccavenue', 'paypal', 'razorpay', 'stripe'])).min(1),
				stuckAfterMinutes: z.number().int().min(5).max(240).default(15),
				reconcileAt: z
					.string()
					.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
					.default('06:30'),
			})
			.optional(),
		messages: z
			.object({
				provider: z.enum(['msg91']),
				channels: z.array(z.enum(['sms', 'email', 'whatsapp'])).min(1),
				lowBalance: z.number().int().min(0).default(1000),
			})
			.optional(),
		clients: z
			.object({
				header: z.string().regex(/^x-[a-z0-9-]{1,40}$/),
				forgetAfterHours: z.number().int().min(1).max(720),
			})
			.optional(),
		seo: z
			.object({
				sitemap: urlPath.default('/sitemap.xml'),
				keyPages: z.array(urlPath).max(50).default(['/']),
				searchConsole: z
					.string()
					.regex(/^(sc-domain:[a-z0-9.-]+|https:\/\/[a-z0-9.-]+\/)$/)
					.optional(),
			})
			.optional(),
		jobs: z
			.object({
				queues: z
					.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/))
					.max(40)
					.default([]),
				scheduled: z.array(id).max(40).default([]),
			})
			.optional(),
		backups: z.object({ script: path, store: z.enum(['spaces', 's3', 'local']) }).optional(),
		links: z.record(id, path).optional(),
		menus: z
			.array(z.string().regex(/^[a-z0-9-]{1,40}$/))
			.max(40)
			.default([]),
	})
	.strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

/** What reading the file found: the manifest (version 1 lifted to 2), and each line it could not use. */
export interface ManifestReading {
	manifest: ReleaseManifest | null;
	problems: string[];
}

const KNOWN = new Set(Object.keys(releaseManifestSchema.shape));

/**
 * Reads the file's JSON. Version 1 (`{"menus": [...]}`) becomes a version 2 manifest with only
 * menus. Unknown top-level keys are reported as "not used" and dropped, never fatal; a key the
 * console knows but cannot read is reported with the reason and dropped too, so one bad line never
 * hides the rest.
 */
export function readManifest(json: unknown, repositoryName = 'repository'): ManifestReading {
	if (typeof json !== 'object' || json === null || Array.isArray(json))
		return { manifest: null, problems: ['The file is not a JSON object.'] };
	const raw = { ...(json as Record<string, unknown>) };
	const problems: string[] = [];
	if (raw['version'] === undefined) {
		raw['version'] = 2;
		raw['product'] = { name: repositoryName, kind: 'other' };
	}
	for (const key of Object.keys(raw))
		if (!KNOWN.has(key)) {
			problems.push(`“${key}” is not used by this console.`);
			delete raw[key];
		}
	// Every other line the console knows is checked on its own; one it cannot read is reported and dropped.
	for (const key of Object.keys(raw)) {
		if (key === 'version' || key === 'product') continue;
		const field = releaseManifestSchema.shape[key as keyof typeof releaseManifestSchema.shape].safeParse(raw[key]);
		if (field.success) continue;
		for (const issue of field.error.issues.slice(0, 1))
			problems.push(`“${[key, ...issue.path].join('.')}” was skipped: ${issue.message}.`);
		delete raw[key];
	}
	// What is left can fail only on the version or the product, which the file cannot do without.
	const parsed = releaseManifestSchema.safeParse(raw);
	if (parsed.success) return { manifest: parsed.data, problems };
	for (const issue of parsed.error.issues.slice(0, 1)) problems.push(`${issue.path.join('.')}: ${issue.message}`);
	return { manifest: null, problems };
}

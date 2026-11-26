/**
 * `pnpm spaces:copy -- --from <bucket> --to <bucket> [--apply] [--confirm <destination bucket>] [--origin <address>]…`
 *
 * Copies one Spaces bucket into another so the apps work from the copy as they are (owner, 2026-11-23: dev's
 * files into staging from time to time, and a trimmed staging into production once). Without --apply it only
 * reports what it would do.
 *
 * - Each bucket's key comes from the Infisical project whose /api/SPACES_BUCKET names it, read into memory with
 *   your Infisical login. Nothing is printed but file names and counts.
 * - Every file keeps its content, type, cache rule, download name, encoding, language, metadata and its public or
 *   private setting. Public or private is read from the source itself: an anonymous request answers 200 for a
 *   public file and 403 for a private one.
 * - A file already the same is left alone; one whose only difference is public/private gets that fixed; nothing in
 *   the destination is ever deleted. Running it again is safe.
 * - Writing into production's bucket needs --confirm with its name.
 * - Afterwards it checks every file again, and the destination's settings that matter to the apps: listing
 *   refused to the public, the CDN serving a public file, and browser uploads allowed from each page address.
 *
 * Files hold no web addresses (checked 2026-11-23), and the database keeps file names, not addresses, so nothing
 * needs rewriting. The YouTube posters' saved addresses are rebuilt from their file names by the API.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exportFolder } from '../secrets/infisical.mjs';
import { describeError, loadInventory, ROOT, TIERS } from '../secrets/inventory.mjs';
import {
	addressOf,
	checkConfirmation,
	corsAllows,
	DEFAULT_ORIGINS,
	fileAction,
	formatCopyReport,
	holderOf,
	KEPT_HEADERS,
	md5OfEtag,
	parseCopyArgs,
	SpacesCopyError,
	visibilityOf,
} from './plan.mjs';

// The S3 client is the storage adapter's own dependency, so the root package needs no second copy of it.
const require = createRequire(`${ROOT}/packages/adapters-storage-spaces/package.json`);

const PARALLEL = 8;

async function pool(items, size, work) {
	let at = 0;
	const failed = [];
	await Promise.all(
		Array.from({ length: size }, async () => {
			while (at < items.length) {
				const item = items[at++];
				try {
					await work(item);
				} catch (error) {
					failed.push(`${item}: ${error?.name ?? 'error'}`);
				}
			}
		}),
	);
	return failed;
}

function bucketOf(api, s3) {
	const region = /** @type {string} */ (api.get('SPACES_REGION'));
	const name = /** @type {string} */ (api.get('SPACES_BUCKET'));
	return {
		name,
		origin: `https://${name}.${region}.digitaloceanspaces.com`,
		cdn: api.get('SPACES_CDN_URL') || null,
		client: new s3.S3Client({
			region,
			endpoint: api.get('SPACES_ENDPOINT'),
			credentials: { accessKeyId: api.get('SPACES_KEY'), secretAccessKey: api.get('SPACES_SECRET') },
		}),
	};
}

async function listFiles(s3, bucket) {
	const files = new Map();
	let token;
	do {
		const page = await bucket.client.send(
			new s3.ListObjectsV2Command({ Bucket: bucket.name, ContinuationToken: token }),
		);
		for (const item of page.Contents ?? []) files.set(item.Key, { size: item.Size ?? 0, etag: item.ETag });
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	return files;
}

async function md5Of(s3, bucket, key) {
	const got = await bucket.client.send(new s3.GetObjectCommand({ Bucket: bucket.name, Key: key }));
	const hash = createHash('md5');
	for await (const chunk of got.Body) hash.update(chunk);
	return hash.digest('hex');
}

/** Everything `fileAction` compares, for one file in one bucket. */
async function describe(s3, bucket, key, listed, { hashMultipart }) {
	const [head, anonymous] = await Promise.all([
		bucket.client.send(new s3.HeadObjectCommand({ Bucket: bucket.name, Key: key })),
		fetch(addressOf(bucket.origin, key), { method: 'HEAD' }),
	]);
	let md5 = md5OfEtag(listed.etag);
	if (md5 === null && hashMultipart) md5 = await md5Of(s3, bucket, key);
	return {
		size: listed.size,
		md5,
		headers: Object.fromEntries(KEPT_HEADERS.map((name) => [name, head[name]])),
		metadata: head.Metadata ?? {},
		visibility: visibilityOf(anonymous.status, key),
	};
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseCopyArgs(argv);
	const inventory = loadInventory();
	const projects = TIERS.map((tier) => {
		const project = inventory.projects[tier];
		return {
			tier,
			api: exportFolder({ projectId: project.projectId, environment: project.environment, folder: 'api' }),
			deployment: () =>
				exportFolder({ projectId: project.projectId, environment: project.environment, folder: 'deployment' }),
		};
	});
	const from = holderOf(args.from, projects);
	const to = holderOf(args.to, projects);
	checkConfirmation(args, to.tier);

	const s3 = require('@aws-sdk/client-s3');
	const source = bucketOf(projects.find((p) => p.tier === from.tier).api, s3);
	const destination = bucketOf(projects.find((p) => p.tier === to.tier).api, s3);

	const [sourceFiles, destinationFiles] = await Promise.all([listFiles(s3, source), listFiles(s3, destination)]);
	const keys = [...sourceFiles.keys()];
	/** @type {Map<string, Awaited<ReturnType<typeof describe>>>} */
	const described = new Map();
	const failed = await pool(keys, PARALLEL, async (key) => {
		const there = destinationFiles.get(key);
		// The source's own content hash is needed only when the destination might already hold the same file.
		const sourceFile = await describe(s3, source, key, sourceFiles.get(key), {
			hashMultipart: there !== undefined && there.size === sourceFiles.get(key).size,
		});
		described.set(key, sourceFile);
	});
	if (failed.length)
		throw new SpacesCopyError(`Could not read ${failed.length} source files: ${failed.slice(0, 5).join('; ')}`);

	const decide = async () => {
		const now = await listFiles(s3, destination);
		/** @type {Map<string, 'copy' | 'set-visibility' | 'same'>} */
		const actions = new Map();
		const errors = await pool(keys, PARALLEL, async (key) => {
			const listed = now.get(key);
			const there = listed ? await describe(s3, destination, key, listed, { hashMultipart: false }) : null;
			const file = /** @type {NonNullable<ReturnType<typeof described.get>>} */ (described.get(key));
			// A multipart source has no content hash in its ETag; work it out once a same-sized copy exists.
			if (file.md5 === null && there && there.size === file.size) file.md5 = await md5Of(s3, source, key);
			actions.set(key, fileAction(file, there));
		});
		return { now, actions, errors };
	};

	let { now, actions, errors } = await decide();
	const count = (map) => {
		const totals = { copy: 0, 'set-visibility': 0, same: 0 };
		for (const action of map.values()) totals[action] += 1;
		return totals;
	};
	const planned = count(actions);
	const writeFailures = [...errors];
	let verify = null;

	if (args.apply) {
		writeFailures.push(
			...(await pool(
				keys.filter((key) => actions.get(key) !== 'same'),
				PARALLEL,
				async (key) => {
					const file = /** @type {NonNullable<ReturnType<typeof described.get>>} */ (described.get(key));
					if (actions.get(key) === 'set-visibility') {
						await destination.client.send(
							new s3.PutObjectAclCommand({ Bucket: destination.name, Key: key, ACL: file.visibility }),
						);
						return;
					}
					const got = await source.client.send(new s3.GetObjectCommand({ Bucket: source.name, Key: key }));
					await destination.client.send(
						new s3.PutObjectCommand({
							Bucket: destination.name,
							Key: key,
							Body: got.Body,
							ContentLength: got.ContentLength,
							ACL: file.visibility,
							Metadata: got.Metadata,
							...Object.fromEntries(KEPT_HEADERS.map((name) => [name, got[name]])),
						}),
					);
				},
			)),
		);
		({ now, actions, errors } = await decide());
		const after = count(actions);
		verify = {
			identical: after.same,
			problems: [
				...errors,
				...[...actions].filter(([, action]) => action !== 'same').map(([key, action]) => `${key} (${action})`),
			],
		};
	}

	// The destination's own settings, read without its key: what a visitor's browser would meet.
	const listing = await fetch(`${destination.origin}/`);
	const publicKey = keys.find((key) => described.get(key)?.visibility === 'public-read' && now.has(key));
	const cdn =
		publicKey && destination.cdn
			? (await fetch(addressOf(destination.cdn, publicKey), { method: 'HEAD' })).status === 200
			: null;
	const deployment = projects.find((p) => p.tier === to.tier).deployment();
	const fromInfisical = [deployment.get('SITE_URL'), deployment.get('ADMIN_URL')]
		.filter(Boolean)
		.map((url) => new URL(/** @type {string} */ (url)).origin);
	const origins = args.origins.length
		? args.origins
		: fromInfisical.length === 2
			? fromInfisical
			: [...(DEFAULT_ORIGINS[/** @type {keyof typeof DEFAULT_ORIGINS} */ (to.tier)] ?? [])];
	const cors = [];
	for (const origin of origins) {
		const answer = await fetch(addressOf(destination.origin, publicKey ?? keys[0] ?? 'cors-check'), {
			method: 'OPTIONS',
			headers: {
				Origin: origin,
				'Access-Control-Request-Method': 'PUT',
				'Access-Control-Request-Headers': 'content-type',
			},
		});
		cors.push({
			origin,
			allowed: corsAllows(answer.status, answer.headers.get('access-control-allow-origin'), origin),
		});
	}

	const report = {
		from: args.from,
		to: args.to,
		fromTier: from.tier,
		toTier: to.tier,
		apply: args.apply,
		files: keys.length,
		bytes: [...sourceFiles.values()].reduce((sum, file) => sum + file.size, 0),
		publicFiles: [...described.values()].filter((file) => file.visibility === 'public-read').length,
		privateFiles: [...described.values()].filter((file) => file.visibility === 'private').length,
		actions: planned,
		extra: [...now.keys()].filter((key) => !sourceFiles.has(key)).length,
		failed: writeFailures,
		verify,
		checks: { listingRefused: listing.status === 403, cdn, cors },
	};
	console.log(formatCopyReport(report));
	const healthy =
		writeFailures.length === 0 &&
		(!verify || verify.problems.length === 0) &&
		report.checks.listingRefused &&
		cdn !== false &&
		cors.every((row) => row.allowed);
	return healthy ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().then(
		(code) => process.exit(code),
		(error) => {
			console.error(error instanceof SpacesCopyError ? error.message : describeError(error));
			process.exit(1);
		},
	);
}

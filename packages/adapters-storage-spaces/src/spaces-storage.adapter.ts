import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	PutObjectAclCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectVisibility, SignedUpload, StoragePort, StoredObject } from '@saha-textile/core-domain';

import { assertValidStorageKey, encodeStorageKeyForUrl } from './storage-key.js';
import { SpacesStorageError, type SpacesObjectAcl, type SpacesStorageConfig } from './types.js';

const DEFAULT_UPLOAD_EXPIRY_SECONDS = 900;
/** S3's DeleteObjects ceiling per request. */
const DELETE_BATCH = 1000;

const aclFor = (visibility: ObjectVisibility): SpacesObjectAcl => (visibility === 'public' ? 'public-read' : 'private');
/** Spaces rejects presigned lifetimes beyond seven days; fail here rather than at upload. */
const MAX_UPLOAD_EXPIRY_SECONDS = 604_800;

/**
 * DigitalOcean Spaces implementation of `StoragePort`.
 *
 * Spaces speaks the S3 API, so this is the AWS SDK pointed at a DigitalOcean regional
 * endpoint. Two details are DigitalOcean-specific and easy to get wrong:
 *
 * 1. `endpoint` carries the REGION but not the bucket. With virtual-hosted addressing the
 *    SDK prepends the bucket itself, producing `https://<bucket>.<region>...`. Passing an
 *    endpoint that already contains the bucket yields `<bucket>.<bucket>.<region>...`,
 *    which resolves to nothing and reads like a DNS fault.
 * 2. The CDN hostname is a different host from the origin, and it DOES include the bucket.
 *    That asymmetry is why `endpoint` and `cdnUrl` are separate settings rather than one
 *    base URL — see `SpacesStorageConfig`.
 *
 * The API never proxies media bytes: browsers upload straight to Spaces through a
 * presigned URL and read straight from the CDN. This adapter therefore mints URLs and
 * performs housekeeping deletes; the only bytes it moves are ones a server-side job
 * (the derivative worker) hands it directly.
 */
export class SpacesStorageAdapter implements StoragePort {
	private readonly client: S3Client;
	private readonly bucket: string;
	private readonly defaultExpirySeconds: number;
	private readonly publicBaseUrl: string;

	constructor(config: SpacesStorageConfig, client?: S3Client) {
		this.bucket = config.bucket;
		this.defaultExpirySeconds = config.defaultUploadExpirySeconds ?? DEFAULT_UPLOAD_EXPIRY_SECONDS;
		this.publicBaseUrl = resolvePublicBaseUrl(config);
		this.client =
			client ??
			new S3Client({
				region: config.region,
				endpoint: config.endpoint,
				// Virtual-hosted addressing: `https://<bucket>.<region>.digitaloceanspaces.com/<key>`,
				// which is what the CDN also serves. Path style would work for the origin but
				// would make origin and CDN URLs disagree in shape for no benefit.
				forcePathStyle: false,
				credentials: {
					accessKeyId: config.key,
					secretAccessKey: config.secret,
				},
			});
	}

	/**
	 * Server-side write. Not the normal upload path — browsers use
	 * `createSignedUploadUrl` — this exists for worker-produced objects such as image
	 * derivatives, which are generated in-process and never touch a client. Derivative keys
	 * are content-hashed, so the worker passes a one-year immutable `cacheControl`.
	 */
	async upload(input: {
		key: string;
		body: Uint8Array;
		contentType: string;
		visibility?: ObjectVisibility;
		cacheControl?: string;
	}): Promise<StoredObject> {
		assertValidStorageKey(input.key);
		try {
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: input.key,
					Body: input.body,
					ContentType: input.contentType,
					ACL: aclFor(input.visibility ?? 'public'),
					...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
				}),
			);
		} catch (err) {
			throw new SpacesStorageError(`Failed to upload object "${input.key}"`, err);
		}
		return { key: input.key, url: this.getUrl(input.key) };
	}

	/** Reads an object's bytes; the worker fetching an original to derive from. */
	async download(key: string): Promise<Uint8Array> {
		assertValidStorageKey(key);
		try {
			const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
			if (!result.Body) throw new Error('empty body');
			return await result.Body.transformToByteArray();
		} catch (err) {
			throw new SpacesStorageError(`Failed to download object "${key}"`, err);
		}
	}

	/**
	 * The public read URL for a key.
	 *
	 * Synchronous and pure by design: everything that persists media stores KEYS, never
	 * URLs, and composes the URL at read time through here. That is what makes moving to a
	 * different bucket, region or CDN a configuration change rather than a data migration.
	 */
	getUrl(key: string): string {
		assertValidStorageKey(key);
		return `${this.publicBaseUrl}/${encodeStorageKeyForUrl(key)}`;
	}

	async delete(key: string): Promise<void> {
		assertValidStorageKey(key);
		try {
			await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
		} catch (err) {
			throw new SpacesStorageError(`Failed to delete object "${key}"`, err);
		}
	}

	/** Batched delete; deleting a key that is already gone is not an error (idempotent jobs). */
	async deleteMany(keys: readonly string[]): Promise<void> {
		keys.forEach(assertValidStorageKey);
		for (let start = 0; start < keys.length; start += DELETE_BATCH) {
			const batch = keys.slice(start, start + DELETE_BATCH);
			try {
				const result = await this.client.send(
					new DeleteObjectsCommand({
						Bucket: this.bucket,
						Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
					}),
				);
				const failed = (result.Errors ?? []).filter((error) => error.Code !== 'NoSuchKey');
				if (failed.length > 0) throw new Error(failed.map((error) => `${error.Key}: ${error.Code}`).join(', '));
			} catch (err) {
				throw new SpacesStorageError(`Failed to delete ${batch.length} objects`, err);
			}
		}
	}

	/** Flips an object's ACL — a moderator approving (or withdrawing) a review photo. */
	async setVisibility(key: string, visibility: ObjectVisibility): Promise<void> {
		assertValidStorageKey(key);
		try {
			await this.client.send(new PutObjectAclCommand({ Bucket: this.bucket, Key: key, ACL: aclFor(visibility) }));
		} catch (err) {
			throw new SpacesStorageError(`Failed to set visibility of "${key}"`, err);
		}
	}

	/**
	 * A short-lived GET for a private object. Signed against the ORIGIN, never the CDN: a
	 * private object must not be cached at an edge, and the CDN cannot verify a signature.
	 */
	async createSignedDownloadUrl(input: { key: string; expiresInSeconds: number }): Promise<string> {
		assertValidStorageKey(input.key);
		this.assertExpiry(input.expiresInSeconds);
		try {
			return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: input.key }), {
				expiresIn: input.expiresInSeconds,
			});
		} catch (err) {
			throw new SpacesStorageError(`Failed to presign download for "${input.key}"`, err);
		}
	}

	/**
	 * Mints a presigned PUT so the browser uploads directly to Spaces.
	 *
	 * The returned `headers` are not advisory. `Content-Type` and `x-amz-acl` are covered
	 * by the signature, so a client that omits either — or sends a different content type
	 * than the one presigned — gets a signature mismatch that surfaces as a 403 and looks
	 * exactly like bad credentials. Replay them verbatim.
	 */
	async createSignedUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
		visibility?: ObjectVisibility;
	}): Promise<SignedUpload> {
		assertValidStorageKey(input.key);
		const expiresIn = input.expiresInSeconds ?? this.defaultExpirySeconds;
		this.assertExpiry(expiresIn);
		// Originals are regeneration masters, never linked from a page: private unless asked.
		const acl = aclFor(input.visibility ?? 'private');

		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: input.key,
			ContentType: input.contentType,
			ACL: acl,
		});

		try {
			const url = await getSignedUrl(this.client, command, { expiresIn });
			return {
				url,
				headers: {
					'Content-Type': input.contentType,
					'x-amz-acl': acl,
				},
			};
		} catch (err) {
			throw new SpacesStorageError(`Failed to presign upload for "${input.key}"`, err);
		}
	}

	private assertExpiry(expiresIn: number): void {
		if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
			throw new SpacesStorageError('presigned expiry must be a positive whole number of seconds');
		}
		if (expiresIn > MAX_UPLOAD_EXPIRY_SECONDS) {
			throw new SpacesStorageError(
				`presigned expiry must be at most ${MAX_UPLOAD_EXPIRY_SECONDS} seconds (seven days)`,
			);
		}
	}
}

/**
 * Prefers the CDN hostname when one is configured and falls back to the bucket origin.
 *
 * Both are valid public URLs, so an absent `cdnUrl` degrades to slower delivery rather
 * than to broken links. In every deployed environment `cdnUrl` is the Cloudflare-fronted
 * CDN hostname (owner lock, 2026-08-23).
 */
function resolvePublicBaseUrl(config: SpacesStorageConfig): string {
	const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
	if (config.cdnUrl) {
		return trimTrailingSlash(config.cdnUrl);
	}
	const endpoint = new URL(config.endpoint);
	return `${endpoint.protocol}//${config.bucket}.${endpoint.host}`;
}

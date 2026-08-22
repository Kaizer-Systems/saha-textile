/**
 * Object ACL applied to uploaded objects.
 *
 * `public-read` is the launch default because product media is served straight from the
 * Spaces CDN to anonymous browsers, and the API is locked out of proxying those bytes.
 * It is a constructor option rather than a constant because whether public objects or
 * signed reads win is still an open owner question; nothing here presumes the answer.
 */
export type SpacesObjectAcl = 'public-read' | 'private';

export interface SpacesStorageConfig {
	/** Spaces access key ID. Should be a BUCKET-SCOPED key, never an account-wide one. */
	key: string;
	secret: string;
	bucket: string;
	/** DigitalOcean region slug, e.g. `sgp1`. Also the SigV4 signing region. */
	region: string;
	/** Regional S3 endpoint WITHOUT the bucket, e.g. `https://sgp1.digitaloceanspaces.com`. */
	endpoint: string;
	/**
	 * CDN base URL INCLUDING the bucket, e.g.
	 * `https://saha-textile-media.sgp1.cdn.digitaloceanspaces.com`.
	 *
	 * Optional: absent means reads are composed against the bucket origin instead. Both
	 * forms are stable public URLs, so this is a delivery choice, not a data one.
	 */
	cdnUrl?: string;
	objectAcl?: SpacesObjectAcl;
	/** Presigned upload lifetime when a caller does not specify one. */
	defaultUploadExpirySeconds?: number;
}

/**
 * Raised when object storage is reached but the operation could not be completed.
 *
 * The provider error is attached as the standard `cause` rather than re-declared as a
 * field, so it survives into logs without the adapter re-implementing what `Error`
 * already does.
 */
export class SpacesStorageError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'SpacesStorageError';
	}
}

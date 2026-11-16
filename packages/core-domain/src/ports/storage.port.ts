export interface StoredObject {
	key: string;
	url: string;
}

/**
 * Who may read an object. `public` objects are served by the CDN; `private` ones (originals,
 * review photos awaiting moderation) are reachable only through a short-lived signed URL.
 */
export type ObjectVisibility = 'public' | 'private';

export interface SignedUpload {
	url: string;
	/**
	 * Headers the browser MUST replay on the upload request, byte for byte.
	 *
	 * A presigned PUT signs a specific set of headers; sending a different `Content-Type`
	 * — or omitting the ACL header the signature covers — makes the computed signature
	 * disagree and the object storage rejects the upload as unauthorized. The failure
	 * reads like a credentials problem and is not one, so the adapter states exactly what
	 * to send rather than leaving the caller to infer it.
	 */
	headers?: Record<string, string>;
	/**
	 * Form fields for a browser POST-policy upload. Distinct from `headers`: a POST policy
	 * carries its signature in the multipart body, a presigned PUT carries it in the URL
	 * and its headers. An adapter populates one or the other, never both.
	 */
	fields?: Record<string, string>;
}

/** Object storage port (implemented by the DigitalOcean Spaces adapter). */
export interface StoragePort {
	/**
	 * Server-side write (worker-produced derivatives). `cacheControl` lets immutable,
	 * content-hashed keys carry a one-year header; `visibility` defaults to `public`.
	 */
	upload(input: {
		key: string;
		body: Uint8Array;
		contentType: string;
		visibility?: ObjectVisibility;
		cacheControl?: string;
	}): Promise<StoredObject>;
	/** Reads an object's bytes (the worker fetching an original). */
	download(key: string): Promise<Uint8Array>;
	getUrl(key: string): string;
	delete(key: string): Promise<void>;
	deleteMany(keys: readonly string[]): Promise<void>;
	/** Flips an object's ACL; used when a moderator approves (or withdraws) a review photo. */
	setVisibility(key: string, visibility: ObjectVisibility): Promise<void>;
	/**
	 * A short-lived read URL for a private object (moderation previews, Media share links).
	 * `fileName` makes the browser save it under that name instead of the storage key's;
	 * `disposition` `attachment` always saves it, `inline` (the default) lets the browser show what
	 * it can.
	 */
	createSignedDownloadUrl(input: {
		key: string;
		expiresInSeconds: number;
		fileName?: string;
		disposition?: 'inline' | 'attachment';
	}): Promise<string>;
	/** Presigned browser PUT. Uploads default to `private`: an original is never public. */
	createSignedUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
		visibility?: ObjectVisibility;
	}): Promise<SignedUpload>;
	/**
	 * A big upload in parts (S11), so a cut-off one carries on where it stopped. The object is
	 * private; the browser PUTs each part to its own signed address; the parts already stored are
	 * read back from storage, so nothing about them has to be kept anywhere else.
	 */
	startMultipartUpload(input: { key: string; contentType: string }): Promise<{ uploadId: string }>;
	createSignedPartUrl(input: {
		key: string;
		uploadId: string;
		partNumber: number;
		expiresInSeconds: number;
	}): Promise<string>;
	listUploadedParts(input: {
		key: string;
		uploadId: string;
	}): Promise<{ partNumber: number; etag: string; size: number }[]>;
	completeMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
	abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
	/** Every stored file under a prefix, page by page (the nightly Spaces check, media step 5). */
	listKeys(prefix: string): AsyncIterable<{ key: string; bytes: number }>;
	/** An object's bytes as they arrive, for files too big to hold whole (the .zip job, media step 5). */
	readStream(key: string): AsyncIterable<Uint8Array>;
	/**
	 * Stores bytes as they are made, in parts, private (the .zip job): nothing is held whole in memory. A failure or
	 * `signal` abort leaves nothing stored. Answers how many bytes were stored.
	 */
	uploadStream(input: {
		key: string;
		contentType: string;
		body: AsyncIterable<Uint8Array>;
		signal?: { readonly aborted: boolean };
	}): Promise<{ bytes: number }>;
}

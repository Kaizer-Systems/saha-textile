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
	/** A short-lived read URL for a private object (moderation previews). */
	createSignedDownloadUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;
	/** Presigned browser PUT. Uploads default to `private`: an original is never public. */
	createSignedUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
		visibility?: ObjectVisibility;
	}): Promise<SignedUpload>;
}

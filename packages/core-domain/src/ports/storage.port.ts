export interface StoredObject {
	key: string;
	url: string;
}

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
	upload(input: { key: string; body: Uint8Array; contentType: string }): Promise<StoredObject>;
	getUrl(key: string): string;
	delete(key: string): Promise<void>;
	createSignedUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
	}): Promise<SignedUpload>;
}

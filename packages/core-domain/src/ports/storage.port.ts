export interface StoredObject {
	key: string;
	url: string;
}

export interface SignedUpload {
	url: string;
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

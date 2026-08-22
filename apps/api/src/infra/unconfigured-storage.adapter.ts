import { Logger } from '@nestjs/common';
import type { SignedUpload, StoragePort, StoredObject } from '@saha-textile/core-domain';

/**
 * Stands in for object storage when no Spaces credentials are configured.
 *
 * A developer or CI job without bucket access must still be able to boot the API and run
 * everything that has nothing to do with media. What that must NOT mean is media code
 * silently half-working: a no-op that returned a plausible URL would let an admin "upload"
 * an image, persist a `mediaAssets` row, and leave a product pointing at an object that
 * was never written — a broken record that only surfaces on the storefront.
 *
 * So every method throws, and says why. Failing at the first media call is the honest
 * outcome; the same reasoning is applied to unconfigured OAuth providers.
 */
export class UnconfiguredStorageAdapter implements StoragePort {
	private static readonly MESSAGE =
		'Object storage is not configured. Set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET to enable media uploads.';

	private readonly logger = new Logger(UnconfiguredStorageAdapter.name);

	constructor() {
		this.logger.warn(UnconfiguredStorageAdapter.MESSAGE);
	}

	upload(): Promise<StoredObject> {
		return Promise.reject(new Error(UnconfiguredStorageAdapter.MESSAGE));
	}

	getUrl(): string {
		throw new Error(UnconfiguredStorageAdapter.MESSAGE);
	}

	delete(): Promise<void> {
		return Promise.reject(new Error(UnconfiguredStorageAdapter.MESSAGE));
	}

	createSignedUploadUrl(): Promise<SignedUpload> {
		return Promise.reject(new Error(UnconfiguredStorageAdapter.MESSAGE));
	}
}

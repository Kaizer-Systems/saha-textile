import type { MediaPurpose } from '@saha-textile/contracts';

/**
 * Ingest policy (`DEC-MEDIA-CAPS`, locked 2026-11-02). The presign handler refuses anything
 * outside it before a byte moves; the worker re-checks the decoded image, which is the real
 * trust boundary. Served to clients through `GET /media/upload-rules`.
 */
export const MEDIA_INGEST_POLICY = {
	maxBytes: 25 * 1024 * 1024,
	maxLongEdge: 8000,
	maxMegapixels: 50,
	/** Short-edge floor per purpose; absent means no hard floor. */
	minShortEdge: { product: 1600, category: 1600 } as Readonly<Partial<Record<MediaPurpose, number>>>,
	/** Off-target uploads beyond this fraction warn, then letterbox on white. */
	aspectWarnTolerance: 0.05,
	targetAspect: {
		product: { width: 3, height: 4 },
		category: { width: 3, height: 4 },
		blog: { width: 16, height: 9 },
		avatar: { width: 1, height: 1 },
		icon: { width: 1, height: 1 },
	} as Readonly<Partial<Record<MediaPurpose, { width: number; height: number }>>>,
	/** Below this long edge a review photo still uploads, with a warning. */
	reviewWarnBelowLongEdge: 500,
	/** Blog photos below this warn (16:9 at ≥2400×1350 is the recommendation). */
	blogRecommendedWidth: 2400,
	maxReviewPhotos: 5,
	acceptedTypes: ['image/jpeg', 'image/png'] as const,
	/** Presigned upload lifetime. */
	uploadUrlTtlSeconds: 900,
	/** Moderation preview lifetime for private review photos. */
	signedPreviewTtlSeconds: 600,
	/** Orphans wait this long between soft and hard delete. */
	gcGraceDays: 30,
	/** A fresh upload is never a GC candidate: the admin may still be attaching it. */
	gcRecencyGuardHours: 48,
} as const;

/** Cache header for content-hashed, never-overwritten derivative keys. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** How far `width × height` is from a target aspect, as a fraction of the target. */
export const aspectDeviation = (width: number, height: number, target: { width: number; height: number }): number => {
	const actual = width / height;
	const wanted = target.width / target.height;
	return Math.abs(actual - wanted) / wanted;
};

export type IngestRefusal =
	| { code: 'type_not_accepted' }
	| { code: 'too_large'; maxBytes: number }
	| { code: 'too_many_pixels'; maxLongEdge: number; maxMegapixels: number }
	| { code: 'below_minimum'; minShortEdge: number };

export type IngestWarning = 'aspect_off_target' | 'below_recommended_size';

/**
 * Checks an upload's declared shape against the policy. Used twice: at presign with the
 * dimensions the browser decoded, and in the worker with the dimensions sharp decoded.
 */
export const checkIngest = (input: {
	purpose: MediaPurpose;
	contentType: string;
	byteSize: number;
	width: number;
	height: number;
}): { refusal: IngestRefusal | null; warnings: IngestWarning[] } => {
	const policy = MEDIA_INGEST_POLICY;
	if (!(policy.acceptedTypes as readonly string[]).includes(input.contentType)) {
		return { refusal: { code: 'type_not_accepted' }, warnings: [] };
	}
	if (input.byteSize > policy.maxBytes) {
		return { refusal: { code: 'too_large', maxBytes: policy.maxBytes }, warnings: [] };
	}
	const longEdge = Math.max(input.width, input.height);
	const shortEdge = Math.min(input.width, input.height);
	if (longEdge > policy.maxLongEdge || input.width * input.height > policy.maxMegapixels * 1_000_000) {
		return {
			refusal: { code: 'too_many_pixels', maxLongEdge: policy.maxLongEdge, maxMegapixels: policy.maxMegapixels },
			warnings: [],
		};
	}
	const floor = policy.minShortEdge[input.purpose];
	if (floor && shortEdge < floor) {
		return { refusal: { code: 'below_minimum', minShortEdge: floor }, warnings: [] };
	}

	const warnings: IngestWarning[] = [];
	const target = policy.targetAspect[input.purpose];
	if (target && aspectDeviation(input.width, input.height, target) > policy.aspectWarnTolerance) {
		warnings.push('aspect_off_target');
	}
	if (input.purpose === 'review' && longEdge < policy.reviewWarnBelowLongEdge) {
		warnings.push('below_recommended_size');
	}
	if (input.purpose === 'blog' && input.width < policy.blogRecommendedWidth) {
		warnings.push('below_recommended_size');
	}
	return { refusal: null, warnings };
};

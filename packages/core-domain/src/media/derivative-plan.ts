import type { MediaAsset, MediaRoleDefinition } from '@saha-textile/contracts';

import type { ImageRenderSpec } from '../ports/image-codec.port';
import { MEDIA_INGEST_POLICY, aspectDeviation } from './policy';

export interface PlannedDerivative {
	role: string;
	roleVersion: number;
	spec: ImageRenderSpec;
}

export interface DerivativePlan {
	derivatives: PlannedDerivative[];
	/** Widths dropped because they would upscale or exceed a banner slot's need. */
	skipped: { role: string; width: number }[];
	/** True when an off-target photo is letterboxed on white to its purpose's shape. */
	letterboxed: boolean;
}

/**
 * Decides every file the worker renders for one source image.
 *
 * Rules, all from the owner lock:
 * - a role applies when its purposes include the asset's purpose, and primary-only roles
 *   (share, feed square, email thumbnail) only when the asset serves as a product's #1;
 * - never upscale: a width the source cannot fill is skipped (and reported);
 * - banners skip widths beyond twice their slot's widest display;
 * - a product/category/blog photo more than 5% off its target shape is letterboxed on white
 *   to that shape instead of being stretched or cropped.
 */
export const planDerivatives = (input: {
	asset: Pick<MediaAsset, 'purpose' | 'maxDisplayWidth'>;
	source: { width: number; height: number };
	roles: readonly MediaRoleDefinition[];
	servesAsPrimary: boolean;
}): DerivativePlan => {
	const { asset, source } = input;
	const target = MEDIA_INGEST_POLICY.targetAspect[asset.purpose];
	const letterboxed =
		!!target &&
		(asset.purpose === 'product' || asset.purpose === 'category' || asset.purpose === 'blog') &&
		aspectDeviation(source.width, source.height, target) > MEDIA_INGEST_POLICY.aspectWarnTolerance;

	const derivatives: PlannedDerivative[] = [];
	const skipped: { role: string; width: number }[] = [];

	for (const role of input.roles) {
		if (!role.purposes.includes(asset.purpose)) continue;
		if (role.primaryOnly && !input.servesAsPrimary) continue;

		for (const width of [...role.widths].sort((a, b) => a - b)) {
			const spec = specFor(role, width, source, letterboxed ? target : undefined);
			const tooBigForSlot =
				role.respectSlotMaxWidth && asset.maxDisplayWidth !== null && width > asset.maxDisplayWidth * 2;
			if (!spec || tooBigForSlot) {
				skipped.push({ role: role.key, width });
				continue;
			}
			const keepAlpha = asset.purpose === 'brand' ? { keepAlpha: true } : {};
			derivatives.push({ role: role.key, roleVersion: role.version, spec: { ...spec, ...keepAlpha } });
		}
	}

	return { derivatives, skipped, letterboxed };
};

/** The render spec for one width, or null when it would need upscaling. */
const specFor = (
	role: MediaRoleDefinition,
	width: number,
	source: { width: number; height: number },
	letterboxTo?: { width: number; height: number },
): ImageRenderSpec | null => {
	const base = { format: role.format, quality: role.quality } as const;

	if (role.fit === 'inside' && letterboxTo) {
		const height = Math.round((width * letterboxTo.height) / letterboxTo.width);
		const scale = Math.min(width / source.width, height / source.height);
		return scale > 1 ? null : { ...base, width, height, fit: 'pad' };
	}
	if (role.fit === 'inside' || !role.aspect) {
		return width > source.width ? null : { ...base, width, height: null, fit: 'inside' };
	}

	const height = Math.round((width * role.aspect.height) / role.aspect.width);
	// `cover` must fill the box from the source; `pad` and `blur` only need the photo to fit inside.
	const scale =
		role.fit === 'cover'
			? Math.max(width / source.width, height / source.height)
			: Math.min(width / source.width, height / source.height);
	return scale > 1 ? null : { ...base, width, height, fit: role.fit };
};

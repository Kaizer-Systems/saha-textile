import type { MediaAsset, ResolvedImage, ResolvedImageSource } from '@saha-textile/contracts';

/**
 * Builds the client-facing image: srcset-ready URLs per role, the intrinsic shape, the
 * placeholder, and alt resolved for the locale (attachment override → asset alt → English).
 *
 * Returns null for an image that cannot be shown publicly yet (still processing, or a
 * private review photo) — callers render nothing rather than a broken box.
 */
export const resolveImage = (input: {
	asset: MediaAsset;
	getUrl: (key: string) => string;
	locale: string;
	fallbackLocale: string;
	altOverride?: Record<string, string>;
	/** When set, every other role is omitted. A card response asks for `card` only. */
	roles?: readonly string[];
}): ResolvedImage | null => {
	const { asset } = input;
	if (asset.visibility !== 'public' || asset.derivatives.length === 0 || !asset.width || !asset.height) return null;

	const allowed = input.roles ? new Set(input.roles) : null;
	const roles: Record<string, ResolvedImageSource[]> = {};
	for (const derivative of [...asset.derivatives].sort((a, b) => a.width - b.width)) {
		if (allowed && !allowed.has(derivative.role)) continue;
		(roles[derivative.role] ??= []).push({
			url: input.getUrl(derivative.storageKey),
			width: derivative.width,
			height: derivative.height,
			format: derivative.format,
		});
	}

	const pick = (map: Record<string, string> | undefined, locale: string) => map?.[locale]?.trim() || undefined;
	const alt =
		pick(input.altOverride, input.locale) ??
		pick(asset.text.alt, input.locale) ??
		pick(input.altOverride, input.fallbackLocale) ??
		pick(asset.text.alt, input.fallbackLocale) ??
		'';

	return {
		assetId: asset.id,
		width: asset.width,
		height: asset.height,
		alt,
		dominantColor: asset.dominantColor,
		thumbHash: asset.thumbHash,
		roles,
	};
};

/** Roles whose stored derivatives were rendered from an older role version. */
export const staleRolesOf = (asset: MediaAsset, currentVersions: ReadonlyMap<string, number>): string[] => [
	...new Set(
		asset.derivatives
			.filter(
				(derivative) =>
					(currentVersions.get(derivative.role) ?? derivative.roleVersion) > derivative.roleVersion,
			)
			.map((derivative) => derivative.role),
	),
];

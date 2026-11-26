import type { ImageDerivative, MediaAsset, ResolvedImage, ResolvedImageSource } from '@saha-textile/contracts';

type ShownSource = Pick<MediaAsset, 'derivatives' | 'versions'>;

/** Each role's chosen version: the rank (in the order versions were asked for) of the first ready one with files of it. */
const roleChoice = (asset: ShownSource): { rank: Map<string, number>; chosen: Map<string, number> } => {
	const ready = (asset.versions ?? []).filter((version) => version.state === 'ready');
	const rank = new Map(ready.map((version, index) => [version.id, index]));
	const chosen = new Map<string, number>();
	for (const file of asset.derivatives) {
		const at = file.versionId ? rank.get(file.versionId) : undefined;
		if (at === undefined) continue;
		const now = chosen.get(file.role);
		if (now === undefined || at < now) chosen.set(file.role, at);
	}
	return { rank, chosen };
};

/**
 * The files the website draws while a page stores only the photo, not its version (until media step 4): for each
 * role, the first ready version that has that role; a picture made once per photo only where no version has its
 * role. So adding a version never changes what a page shows, and two versions are never mixed in one list.
 */
export const shownDerivatives = (asset: ShownSource): ImageDerivative[] => {
	const { rank, chosen } = roleChoice(asset);
	return asset.derivatives.filter((file) => {
		const pick = chosen.get(file.role);
		if (pick === undefined) return true;
		return !!file.versionId && rank.get(file.versionId) === pick;
	});
};

/**
 * The files a place draws when it stores a version (R4-1, media step 4): that version's files, plus pictures made once
 * per photo for roles it has none of. A version that is gone or not ready falls back to `shownDerivatives`, so the
 * place still shows the photo.
 */
export const derivativesFor = (asset: ShownSource, versionId?: string | null): ImageDerivative[] => {
	const stored = versionId
		? (asset.versions ?? []).find((version) => version.id === versionId && version.state === 'ready')
		: undefined;
	const files = stored ? asset.derivatives.filter((file) => file.versionId === stored.id) : [];
	if (!files.length) return shownDerivatives(asset);
	const roles = new Set(files.map((file) => file.role));
	return [...files, ...asset.derivatives.filter((file) => !file.versionId && !roles.has(file.role))];
};

/** The versions the website draws from (see shownDerivatives): these count as in use while the photo is used. */
export const shownVersionIds = (asset: ShownSource): Set<string> => {
	const { rank, chosen } = roleChoice(asset);
	const picked = new Set(chosen.values());
	return new Set([...rank].filter(([, at]) => picked.has(at)).map(([id]) => id));
};

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
	/** The version this place stores (media step 4); absent: the version the website picks by itself. */
	versionId?: string | null;
}): ResolvedImage | null => {
	const { asset } = input;
	if (asset.visibility !== 'public' || asset.derivatives.length === 0 || !asset.width || !asset.height) return null;

	const allowed = input.roles ? new Set(input.roles) : null;
	const roles: Record<string, ResolvedImageSource[]> = {};
	for (const derivative of [...derivativesFor(asset, input.versionId)].sort((a, b) => a.width - b.width)) {
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

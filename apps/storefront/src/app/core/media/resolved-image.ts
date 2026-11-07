/** One width of one role (`ResolvedImageSource` from `@saha-textile/contracts`). */
export interface ResolvedImageSource {
	url: string;
	width: number;
	height: number;
}

/**
 * `ResolvedImage` from `@saha-textile/contracts`, as the storefront reads it: the intrinsic
 * shape (so the box is sized before a byte arrives) and srcset-ready URLs per role. A payload
 * may carry only the roles its slot renders.
 */
export interface ResolvedImage {
	width: number;
	height: number;
	dominantColor: string | null;
	roles: Record<string, ResolvedImageSource[]>;
}

/** `srcset` for one role of an image, or null when the image or role is absent. */
export const roleSrcset = (image: ResolvedImage | null | undefined, role: string): string | null =>
	image?.roles[role]?.map((source) => `${source.url} ${source.width}w`).join(', ') || null;

import { z } from 'zod';

/**
 * Shared lifecycle vocabulary for catalog entities (categories, placements, facet
 * configs, variants, bundles, relations).
 *
 * It deliberately mirrors `ProductStatus` value-for-value so the whole catalog speaks
 * one language instead of the `active|hidden|archived` / `draft|published|archived`
 * mix the pre-lock architecture sketches used. A test asserts the two stay identical —
 * if the product lifecycle is ever re-locked, that test fails rather than letting the
 * vocabularies quietly diverge.
 *
 * - `draft`        — never published.
 * - `live`         — the only publicly visible state.
 * - `disabled`     — hidden, fully retained, reversible.
 * - `discontinued` — hidden and inside its retention window.
 */
export const CatalogStatus = z.enum(['draft', 'live', 'disabled', 'discontinued']);
export type CatalogStatus = z.infer<typeof CatalogStatus>;

/** True only for the publicly visible state — mirrors core-domain `isStorefrontVisible`. */
export const isPubliclyVisibleStatus = (status: CatalogStatus): boolean => status === 'live';

/**
 * How a category node is used. `taxonomy` is the real product classification; the rest
 * are merchandising lenses over the same products (the owner lock keeps curated
 * collections distinct from strict taxonomy).
 */
export const CategoryKind = z.enum(['taxonomy', 'collection', 'occasion', 'fabric', 'weave', 'budget', 'admin']);
export type CategoryKind = z.infer<typeof CategoryKind>;

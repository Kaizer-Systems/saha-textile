/**
 * The API's tag vocabulary — one declaration, used by every controller and by the document
 * builder that describes them.
 *
 * Tags were free-form strings scattered across eleven controllers, which is fine until one is
 * spelled `catalogue`, or a new controller invents `authentication` alongside `auth`. A
 * generated client turns tags into namespaces, so a typo there is a renamed namespace for
 * every consumer. `scripts/check-openapi.mjs` rejects any tag outside this object.
 *
 * The values are frozen vocabulary, not labels: renaming one is a breaking change for
 * generated clients and belongs in a version bump, not a tidy-up.
 */
export const API_TAGS = {
	health: 'health',
	catalog: 'catalog',
	currency: 'currency',
	promotions: 'promotions',
	cart: 'cart',
	orders: 'orders',
	auth: 'auth',
	privacy: 'privacy',
} as const;

export type ApiTag = (typeof API_TAGS)[keyof typeof API_TAGS];

/**
 * Declared order and description for each tag. Ordering is part of the contract too: a
 * document that lists its tags in whatever order the controllers happened to register makes
 * every regeneration a noisy diff, which is how real changes get missed in review.
 */
export const API_TAG_DESCRIPTIONS: ReadonlyArray<{ name: ApiTag; description: string }> = [
	{ name: API_TAGS.health, description: 'Liveness and readiness probes. No authentication, no side effects.' },
	{ name: API_TAGS.catalog, description: 'Public product and category browsing. Only live products are queryable.' },
	{ name: API_TAGS.currency, description: 'Supported currencies and conversion.' },
	{ name: API_TAGS.promotions, description: 'Active promotions and coupon validation.' },
	{ name: API_TAGS.cart, description: 'Cart lifecycle. Ownership is proven by session or hashed guest token.' },
	{ name: API_TAGS.orders, description: 'Order placement and retrieval, scoped to the caller.' },
	{
		name: API_TAGS.auth,
		description:
			'Session lifecycle for both audiences. Sessions are httpOnly cookies set by the API; no token is ever returned in a response body.',
	},
	{ name: API_TAGS.privacy, description: 'Consent, data export and erasure requests.' },
];

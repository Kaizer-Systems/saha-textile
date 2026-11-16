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
	storefrontAccount: 'storefront-account',
	privacy: 'privacy',
	media: 'media',
	reviews: 'reviews',
	blog: 'blog',
	events: 'events',
	stores: 'stores',
	mailboxes: 'mailboxes',
	wishlist: 'wishlist',
	languages: 'languages',
	purchases: 'purchases',
	stock: 'stock',
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
	{
		name: API_TAGS.storefrontAccount,
		description:
			"A customer's own account data. Every route is scoped to the session principal — these carry no customer id, so one shopper cannot address another's account.",
	},
	{ name: API_TAGS.privacy, description: 'Consent, data export and erasure requests.' },
	{
		name: API_TAGS.media,
		description:
			'Media library, presigned uploads, size roles, banners and the YouTube rail. Clients receive resolved image URLs and never compose one.',
	},
	{
		name: API_TAGS.reviews,
		description: 'Verified-buyer reviews with photos, and their moderation. Photos stay private until approved.',
	},
	{
		name: API_TAGS.blog,
		description:
			'Blog posts, categories and tags. The shop reads live posts in one language; the admin writes every language and goes live only when all are complete.',
	},
	{
		name: API_TAGS.events,
		description:
			'Launch and sale events. The shop reads published events with the server clock for its countdowns; the admin prepares, reviews, publishes and cancels them. Sale prices are laid over shop reads while a sale runs.',
	},
	{
		name: API_TAGS.stores,
		description:
			"The shop's physical stores. Contact Us reads active stores in one language; the super admin writes every language under Settings › Stores.",
	},
	{
		name: API_TAGS.mailboxes,
		description:
			'Gmail mailboxes in the admin and the Contact Us form. The super admin connects mailboxes and decides who may read or send; the Inbox reads mail live from Gmail; Contact Us messages are stored, then placed in the chosen mailbox.',
	},
	{
		name: API_TAGS.wishlist,
		description:
			"A signed-in customer's saved products. The customer comes from the session; a guest's list stays in a session cookie and merges in on sign-in.",
	},
	{
		name: API_TAGS.languages,
		description:
			'The active languages, English first: the one list the admin and the shop both read. No authentication.',
	},
	{
		name: API_TAGS.purchases,
		description:
			'Suppliers, purchase orders, purchase entries (supplier bills taken into stock), payments and purchase returns with debit notes. Admin only; every write is audited as a sentence.',
	},
	{
		name: API_TAGS.stock,
		description:
			'Stock on hand, held and free to sell; history, cost layers (FIFO), adjustments with approval, holds, counts, opening stock, reorder list and reports. Cost and value fields are left out for anyone without stock.cost.',
	},
];

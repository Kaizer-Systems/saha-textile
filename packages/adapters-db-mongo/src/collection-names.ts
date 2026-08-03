/**
 * Physical MongoDB collection names.
 *
 * ## Why this file exists
 *
 * Mongoose derives a collection name from the model name when `collection` is omitted:
 * `AuthSession` becomes `authsessions`, `MessageOutbox` becomes `messageoutboxes`. Every
 * multiword model in this adapter therefore landed on a lowercase, sometimes wrongly
 * pluralized physical name that does NOT match the ratified Schema Nebula graph
 * (`docs/_data/instruments/schema-nebula.json`, 64 nodes) or the auth architecture's
 * §7 collection list. The auth delivery matrix records this as **RECONCILE FIRST**.
 *
 * Each schema now passes `collection: '<name>'` explicitly, and this module is the single
 * declaration those literals are checked against. A model whose physical name drifts from
 * the locked graph fails `test/collection-names.test.ts` — the name is an interface with
 * the database, migrations, MCP tooling, MongoDB Compass and the generated catalogue, not
 * an implementation detail Mongoose may choose for us.
 *
 * ## Two names that are deliberately singular
 *
 * `inventoryLedger` and `messageOutbox` are singular in the ratified graph. Mongoose would
 * have produced `inventoryledgers` / `messageoutboxes`. The graph wins.
 *
 * ## `authRateLimits` is not a graph node
 *
 * Authentication rate limiting is mandatory, but the auth architecture (§7 closing note)
 * keeps its backing an adapter/runtime concern rather than a locked Schema Nebula node.
 * It gets an explicit, consistent name here so its physical identity is still reviewed —
 * it simply must never be counted as one of the 64 stars.
 */

/** Model class name → ratified physical collection name. */
export const COLLECTION_NAMES = {
	// --- Catalog -------------------------------------------------------------
	Category: 'categories',
	CategoryPlacement: 'categoryPlacements',
	CategoryFacetConfig: 'categoryFacetConfigs',
	AttributeDefinition: 'attributeDefinitions',
	Product: 'products',
	ProductVariant: 'productVariants',
	ProductBundle: 'productBundles',
	ProductRelation: 'productRelations',
	// --- Commerce ------------------------------------------------------------
	Cart: 'carts',
	Order: 'orders',
	Promotion: 'promotions',
	Currency: 'currencies',
	// --- Identity, auth, authorization ---------------------------------------
	User: 'users',
	AuthSession: 'authSessions',
	OtpChallenge: 'otpChallenges',
	OAuthState: 'oauthStates',
	PasswordResetToken: 'passwordResetTokens',
	EmailVerificationToken: 'emailVerificationTokens',
	AdminInvite: 'adminInvites',
	/** Adapter/runtime abuse counters — intentionally NOT a Schema Nebula node. */
	AuthRateLimit: 'authRateLimits',
	// --- Governance, privacy, notifications ----------------------------------
	AuditLog: 'auditLogs',
	ConsentEvent: 'consentEvents',
	NotificationChannelSettings: 'notificationChannelSettings',
	NotificationTemplate: 'notificationTemplates',
	MessageOutbox: 'messageOutbox',
	// --- Media and inventory -------------------------------------------------
	MediaAsset: 'mediaAssets',
	InventoryLedger: 'inventoryLedger',
	InventoryCostLayer: 'inventoryCostLayers',
	// --- Content -------------------------------------------------------------
	FaqEntry: 'faqEntries',
	ProductQuestion: 'productQuestions',
	Review: 'reviews',
	RatingAggregate: 'ratingAggregates',
} as const satisfies Record<string, string>;

export type ModelName = keyof typeof COLLECTION_NAMES;

/**
 * Collections whose ratified name is NOT one of the 64 Schema Nebula nodes.
 *
 * Keeping this explicit stops the list above from being read as "these are all locked
 * graph collections" — the portal's star evidence must not promote a runtime concern.
 * `productQuestions` and `ratingAggregates` are implemented models that the ratified
 * 64-node graph does not currently carry a node for; that gap is a documentation
 * reconciliation for the portal/owner, not a licence to rename the collections.
 */
export const NON_GRAPH_COLLECTIONS: readonly string[] = ['authRateLimits', 'productQuestions', 'ratingAggregates'];

/**
 * Physical names these collections used to resolve to, before explicit naming.
 *
 * Only entries whose Mongoose default DIFFERED from the ratified name appear here; that is
 * exactly the set a deployed or local database may still hold data under. Consumed by
 * `migrations/align-collection-names.ts`.
 */
export const LEGACY_COLLECTION_NAMES: Readonly<Record<string, string>> = {
	authsessions: 'authSessions',
	otpchallenges: 'otpChallenges',
	oauthstates: 'oauthStates',
	passwordresettokens: 'passwordResetTokens',
	emailverificationtokens: 'emailVerificationTokens',
	admininvites: 'adminInvites',
	authratelimits: 'authRateLimits',
	auditlogs: 'auditLogs',
	consentevents: 'consentEvents',
	notificationchannelsettings: 'notificationChannelSettings',
	notificationtemplates: 'notificationTemplates',
	messageoutboxes: 'messageOutbox',
	categoryplacements: 'categoryPlacements',
	categoryfacetconfigs: 'categoryFacetConfigs',
	attributedefinitions: 'attributeDefinitions',
	productvariants: 'productVariants',
	productbundles: 'productBundles',
	productrelations: 'productRelations',
	mediaassets: 'mediaAssets',
	inventoryledgers: 'inventoryLedger',
	inventorycostlayers: 'inventoryCostLayers',
	faqentries: 'faqEntries',
	productquestions: 'productQuestions',
	ratingaggregates: 'ratingAggregates',
};

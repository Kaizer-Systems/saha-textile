/**
 * Physical MongoDB collection names.
 *
 * ## Why this file exists
 *
 * Mongoose derives a collection name from the model name when `collection` is omitted:
 * `AuthSession` becomes `authsessions`, `MessageOutbox` becomes `messageoutboxes`. Every
 * multiword model in this adapter therefore landed on a lowercase, sometimes wrongly
 * pluralized physical name that does NOT match the ratified Schema Nebula graph
 * (`docs/_data/instruments/schema-nebula.json`, 67 nodes) or the auth architecture's
 * §7 collection list (as amended by `DEC-ACCOUNT-SEPARATION`). The auth delivery matrix
 * records physical-name alignment as **RECONCILE FIRST**.
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
 * it simply must never be counted as one of the 67 stars.
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
	/** Storefront shoppers — Schema Nebula `customers` (`DEC-ACCOUNT-SEPARATION`). */
	Customer: 'customers',
	/** Back-office operators — Schema Nebula `adminUsers` (`DEC-ACCOUNT-SEPARATION`). */
	AdminUser: 'adminUsers',
	/** Password hashes — auth §7.3 (extracted from account docs). */
	PasswordCredential: 'passwordCredentials',
	/** Admin PIN hashes + lockout — auth §7.3A. */
	PinCredential: 'pinCredentials',
	/** Login identity links — auth §7.2. */
	AuthIdentity: 'authIdentities',
	AuthSession: 'authSessions',
	OtpChallenge: 'otpChallenges',
	OAuthState: 'oauthStates',
	PasswordResetToken: 'passwordResetTokens',
	EmailVerificationToken: 'emailVerificationTokens',
	AdminInvite: 'adminInvites',
	Role: 'roles',
	AdminUserRoleAssignment: 'adminUserRoleAssignments',
	/** Adapter/runtime abuse counters — intentionally NOT a Schema Nebula node. */
	AuthRateLimit: 'authRateLimits',
	/**
	 * Verified-but-not-yet-created signups (`DEC-SIGNUP-VERIFICATION`) — intentionally NOT a
	 * Schema Nebula node. A row lives 15–30 minutes, holds no business record, is referenced
	 * by nothing, and is deleted by TTL; it exists so a real customer can be born.
	 */
	PendingSignup: 'pendingSignups',
	/**
	 * Started-but-unproven changes of email or phone — intentionally NOT a Schema Nebula node,
	 * for the same reasons as `pendingSignups`. A row lives 15–30 minutes and exists so that an
	 * account's recovery channel can only move once somebody has proven the new one.
	 */
	PendingContactChange: 'pendingContactChanges',
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
 * Collections deliberately outside the ratified data model.
 *
 * MACHINERY, not domain data. A rate-limit counter and a half-finished signup are scaffolding
 * that exists so real records can be written safely; putting either into the governed 67-node
 * graph would make that graph LESS truthful, not more, by promoting a runtime concern to the
 * same standing as an order or a customer.
 *
 * Absence from the graph is a classification here, never a shortcut. Anything that is genuinely
 * part of the data model belongs in the Schema Nebula graph, not in a debt list.
 */
const RUNTIME_ONLY_COLLECTIONS = ['authRateLimits', 'pendingSignups', 'pendingContactChanges'] as const;

/**
 * Formerly held implemented collections the graph had not caught up with.
 * Empty: `productQuestions` and `ratingAggregates` are now Schema Nebula nodes.
 */
export const GRAPH_RECONCILIATION_OWED = [] as const;

/** Every collection the Schema Nebula assertion must skip, whatever the reason. */
export const NON_GRAPH_COLLECTIONS: readonly string[] = [...RUNTIME_ONLY_COLLECTIONS, ...GRAPH_RECONCILIATION_OWED];

/**
 * Physical names these collections used to resolve to, before explicit naming.
 *
 * Only entries whose Mongoose default DIFFERED from the ratified name appear here; that is
 * exactly the set a deployed or local database may still hold data under. Consumed by
 * `migrations/align-collection-names.ts`.
 *
 * `userRoleAssignments` is the one entry that is not a Mongoose default but a previously
 * RATIFIED explicit name, retired on 2026-08-15: the join is operator-only, so the bare noun
 * named a population it never held. Both spellings are listed because a database may hold
 * either — the lowercase Mongoose default from before explicit naming, or the camelCase
 * explicit name from after it.
 */
export const LEGACY_COLLECTION_NAMES: Readonly<Record<string, string>> = {
	users: 'customers',
	userroleassignments: 'adminUserRoleAssignments',
	userRoleAssignments: 'adminUserRoleAssignments',
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

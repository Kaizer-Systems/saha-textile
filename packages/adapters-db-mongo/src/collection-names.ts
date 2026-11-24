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
	StockAlert: 'stockAlerts',
	ProductInsightSet: 'productInsightSets',
	AttributeDefinition: 'attributeDefinitions',
	Product: 'products',
	ProductVariant: 'productVariants',
	ProductBundle: 'productBundles',
	/** The "Set price is" list for bundles, made in the method builder (owner, 2026-11-22). */
	BundlePriceMethod: 'bundlePriceMethods',
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
	/** Which data migrations ran on this database (release-steps runner). */
	ReleaseMigration: 'releaseMigrations',
	/** Products whose search entry waits to be refreshed (search change queue). */
	/** Facts a release remembers, such as the last search version built. */
	ReleaseMarker: 'releaseMarkers',
	SearchOutbox: 'searchOutbox',
	/** Runs of the nightly search check. */
	SearchCheck: 'searchChecks',
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
	/** Editable size ladder (owner log § Media, `mediaRoles` locked 2026-08-23). */
	MediaRole: 'mediaRoles',
	/** Image profiles (media build step 2, Settings › Image profiles). */
	MediaProfile: 'mediaProfiles',
	InventoryLedger: 'inventoryLedger',
	InventoryCostLayer: 'inventoryCostLayers',
	Supplier: 'suppliers',
	SupplierItemCode: 'supplierItemCodes',
	PurchaseOrder: 'purchaseOrders',
	PurchaseInvoice: 'purchaseInvoices',
	SupplierPayment: 'supplierPayments',
	PurchaseReturn: 'purchaseReturns',
	StockHold: 'stockHolds',
	StockAdjustment: 'stockAdjustments',
	StockCount: 'stockCounts',
	OpeningStock: 'openingStocks',
	InventorySettings: 'inventorySettings',
	/** Settings › Shop details (purchases brief R3-1): the shop's own name, GSTIN and address on documents. */
	ShopDetails: 'shopDetails',
	/** Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2). */
	CompanyProfile: 'companyProfile',
	GstRegistration: 'gstRegistrations',
	FeatureSwitches: 'featureSwitches',
	EDocSettings: 'edocSettings',
	EDocument: 'eDocuments',
	EDocCall: 'edocCalls',
	EDocKeys: 'edocKeys',
	Location: 'locations',
	AdminUserLocations: 'adminUserLocations',
	/** The general ledger (accounts brief Q, T, D10). */
	AccountGroup: 'accountGroups',
	Ledger: 'ledgers',
	JournalVoucher: 'journalVouchers',
	JournalLine: 'journalLines',
	PeriodLock: 'periodLocks',
	DocumentLock: 'documentLocks',
	VoucherDraft: 'voucherDrafts',
	GstReturn: 'gstReturns',
	TaxInvoice: 'taxInvoices',
	/** Returns, credit notes and debit notes (accounts brief B). */
	OrderReturn: 'orderReturns',
	CreditNote: 'creditNotes',
	DebitNote: 'debitNotes',
	RefundVoucher: 'refundVouchers',
	AccountsTemplate: 'accountsTemplates',
	TemplateInstall: 'templateInstalls',
	SelfInvoice: 'selfInvoices',
	PaymentVoucher: 'paymentVouchers',
	LedgerSetting: 'ledgerSettings',
	/** Cash (accounts brief O): settings, boxes, sheets and their lines, petty expenses, staff claims. */
	CashSetting: 'cashSettings',
	CashBox: 'cashBoxes',
	CashSheet: 'cashSheets',
	CashSheetLine: 'cashSheetLines',
	PettyExpense: 'pettyExpenses',
	ExpenseClaim: 'expenseClaims',
	/** Stock transfers between locations (accounts brief N). */
	StockTransfer: 'stockTransfers',
	/** Bank accounts beside their ledgers (accounts brief BA). */
	BankAccount: 'bankAccounts',
	BankLayout: 'bankLayouts',
	BankLine: 'bankLines',
	BankImport: 'bankImports',
	/** The rules that suggest matches for statement lines (BA10). */
	BankMatchRule: 'bankMatchRules',
	/** Gateway payouts and courier COD remittances (accounts brief Q10). */
	Settlement: 'settlements',
	/** GST returns prepared from the books, before and after approval (accounts brief G4). */
	GstReturnDraft: 'gstReturnDrafts',
	/** GSTR-2B files imported from the portal, with what was done on IMS for each line (accounts brief G5). */
	Gstr2bImport: 'gstr2bImports',
	/** Why each GSTR-9 table differs from the books, per registration and year (accounts brief G9). */
	GstAnnualNote: 'gstAnnualNotes',
	/** Reports saved from the builder: choices, never figures (accounts brief V2). */
	ReportDefinition: 'reportDefinitions',
	/** The fixed asset register (accounts brief R1–R4). */
	FixedAsset: 'fixedAssets',
	/** Stock split by location (accounts brief F4). */
	LocationStock: 'locationStock',
	/** Settings › Document formats (bundle builder brief F, 2026-11-22): one active format per document. */
	DocumentFormat: 'documentFormats',
	Sequence: 'sequences',
	// --- Content -------------------------------------------------------------
	FaqEntry: 'faqEntries',
	ProductQuestion: 'productQuestions',
	Review: 'reviews',
	RatingAggregate: 'ratingAggregates',
	ContentBlock: 'contentBlocks',
	BlogPost: 'blogPosts',
	BlogCategory: 'blogCategories',
	BlogTag: 'blogTags',
	/** Launch and sale events (owner log § launch and sale events, 2026-11-09). */
	ShopEvent: 'shopEvents',
	/** The shop's physical stores, shown as cards on Contact Us. */
	StoreLocation: 'storeLocations',
	/** The Media page (step 1): folders, stars, share links. */
	MediaFolder: 'mediaFolders',
	MediaFavourite: 'mediaFavourites',
	MediaShareLink: 'mediaShareLinks',
	/** Email pictures whose photo was deleted or replaced, kept for good for emails already sent (step 3f). */
	EmailPicture: 'emailPictures',
	/** Folder downloads as .zip while they are made and for the 24 hours their link works (media step 5). */
	MediaZip: 'mediaZips',
	/** The four legal pages and every earlier version of them (Legal Pages brief, 2026-11-16). */
	LegalPage: 'legalPages',
	LegalPageRevision: 'legalPageRevisions',
	/** Unfinished product-form work, kept apart from products (product bulk actions brief § 7, 2026-11-19). */
	ProductDraft: 'productDrafts',
	/** Page Builder: each page's schedule, its layouts, their append-only revisions, saved blocks (2026-11-17). */
	BuilderPage: 'builderPages',
	PageLayout: 'pageLayouts',
	PageLayoutRevision: 'pageLayoutRevisions',
	SavedBlock: 'savedBlocks',
	/** Bytes held for running uploads; machinery, removed by its own expiry. */
	StorageReservation: 'storageReservations',
	/** Settings › Languages: every language ever added, English included (step 0d, 2026-11-15). */
	Language: 'languages',
	/** Settings › Communications: message × channel switches an operator changed. */
	CommunicationSwitch: 'communicationSwitches',
	/** Gmail mailboxes connected in the admin, who may open them, and Contact Us messages. */
	Mailbox: 'mailboxes',
	MailboxAccess: 'mailboxAccess',
	ContactMessage: 'contactMessages',
	/** Inbox messages waiting out Undo Send; machinery, removed by its own expiry (2026-11-19). */
	MailboxOutbox: 'mailboxOutbox',
	/** Inbox saved replies: shared per mailbox, or one admin user's own (2026-11-19). */
	SavedReply: 'savedReplies',
	/** Shipping (brief approved 2026-11-19): rule sets, the versions made active, exceptions, zone settings. */
	ShippingRuleSet: 'shippingRuleSets',
	ShippingRuleSetVersion: 'shippingRuleSetVersions',
	ShippingException: 'shippingExceptions',
	ShippingProviderConfig: 'shippingProviderConfigs',
	/** Orders and checkout (brief approved 2026-11-20): payments, payment requests, shipments. */
	Payment: 'payments',
	PaymentRequest: 'paymentRequests',
	/** One press of Pay at the shop checkout; the gateway's answers are judged against it. */
	PaymentAttempt: 'paymentAttempts',
	Shipment: 'shipments',
	/** A business's two accounts (receivable and payable), append-only. */
	LedgerEntry: 'ledgerEntries',
	/** Zones for business customers (DEC-B2B-ZONES) and coupons (DEC-PROMO-STACK). */
	PriceZone: 'priceZones',
	Coupon: 'coupons',
	CouponUse: 'couponUses',
	/** Typed site settings: home hero layout, YouTube rail settings and cache. */
	SiteSetting: 'siteSettings',
	SeoRedirect: 'seoRedirects',
	SeoRoute: 'seoRoutes',
	AddonTemplate: 'addonTemplates',
	// --- Search and analytics ------------------------------------------------
	/** The admin's search words — catalog plan §7.16. */
	SearchTerm: 'searchDictionary',
	/** Search totals per normalised words and language — catalog plan §7.18. */
	SearchQueryAggregate: 'searchQueryAggregates',
	/** Daily figures per grain and key — catalog plan §7.38. */
	AnalyticsDailyAggregate: 'analyticsDailyAggregates',
	// --- Customer lists ------------------------------------------------------
	/** A signed-in customer's saved products (owner decision 2026-11-08). */
	WishlistItem: 'wishlistItems',
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
const RUNTIME_ONLY_COLLECTIONS = [
	'authRateLimits',
	'pendingSignups',
	'pendingContactChanges',
	'releaseMigrations',
	'searchOutbox',
	'searchChecks',
	'releaseMarkers',
	'storageReservations',
	'mailboxOutbox',
] as const;

/**
 * Implemented collections the governed graph has not caught up with (its node count is ratified, so new nodes wait for
 * a graph round): the bundle builder's price methods and Settings › Document formats (22 Nov 2026); the accounts
 * brief's company profile, GST registrations and feature switches (23 Nov 2026).
 */
export const GRAPH_RECONCILIATION_OWED = [
	'bundlePriceMethods',
	'documentFormats',
	'companyProfile',
	'gstRegistrations',
	'featureSwitches',
	'edocSettings',
	'eDocuments',
	'edocCalls',
	'edocKeys',
	'locations',
	'adminUserLocations',
	'accountGroups',
	'ledgers',
	'journalVouchers',
	'journalLines',
	'periodLocks',
	'documentLocks',
	'locationStock',
	'voucherDrafts',
	'gstReturns',
	'taxInvoices',
	'orderReturns',
	'creditNotes',
	'debitNotes',
	'refundVouchers',
	'accountsTemplates',
	'templateInstalls',
	'selfInvoices',
	'paymentVouchers',
	'ledgerSettings',
	'cashSettings',
	'cashBoxes',
	'cashSheets',
	'cashSheetLines',
	'pettyExpenses',
	'expenseClaims',
	'stockTransfers',
	'bankAccounts',
	'bankLayouts',
	'bankLines',
	'bankImports',
	'bankMatchRules',
	'settlements',
	'gstReturnDrafts',
	'gstr2bImports',
	'gstAnnualNotes',
	'reportDefinitions',
	'fixedAssets',
] as const;

/** Every collection the Schema Nebula assertion must skip, whatever the reason. */
export const NON_GRAPH_COLLECTIONS: readonly string[] = [...RUNTIME_ONLY_COLLECTIONS, ...GRAPH_RECONCILIATION_OWED];

/**
 * Physical names these collections used to resolve to, before explicit naming.
 *
 * Only entries whose Mongoose default DIFFERED from the ratified name appear here; that is
 * exactly the set a deployed or local database may still hold data under. Consumed by
 * `migrations/align-collection-names.ts`.
 *
 * The explicit operator-only names `userRoleAssignments` and `userLocations` also need
 * alignment. The role join has both an old Mongoose default and an old explicit name, so
 * both spellings map to the same collection.
 */
export const LEGACY_COLLECTION_NAMES: Readonly<Record<string, string>> = {
	users: 'customers',
	userroleassignments: 'adminUserRoleAssignments',
	userRoleAssignments: 'adminUserRoleAssignments',
	userLocations: COLLECTION_NAMES.AdminUserLocations,
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
	stockalerts: 'stockAlerts',
	productinsightsets: 'productInsightSets',
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

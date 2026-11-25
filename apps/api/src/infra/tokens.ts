/** Dependency-injection tokens binding core-domain ports to infra adapters. */
export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
export const PRODUCT_VARIANT_REPOSITORY = Symbol('ProductVariantRepository');
export const SEO_REDIRECT_REPOSITORY = Symbol('SeoRedirectRepository');
export const SEO_ROUTE_REPOSITORY = Symbol('SeoRouteRepository');
export const STOCK_ALERT_REPOSITORY = Symbol('StockAlertRepository');
export const FAQ_REPOSITORY = Symbol('FaqRepository');
export const PRODUCT_QUESTION_REPOSITORY = Symbol('ProductQuestionRepository');
export const PRODUCT_RELATION_REPOSITORY = Symbol('ProductRelationRepository');
export const PRODUCT_BUNDLE_REPOSITORY = Symbol('ProductBundleRepository');
/** Products › Bundle price methods (bundle builder brief, 2026-11-22). */
export const BUNDLE_PRICE_METHOD_REPOSITORY = Symbol('BundlePriceMethodRepository');
/** Reads a bundle's items against their live products: shop page, builder, cart, checkout and stock. */
export const BUNDLE_READER = Symbol('BundleReader');
/** Refreshes bundles' worked-out stock after a piece's stock moves. */
export const BUNDLE_STOCK = Symbol('BundleStock');
export const SEARCH_PORT = Symbol('SearchPort');
/** The search change queue (outbox). */
export const SEARCH_OUTBOX = Symbol('SearchOutboxRepository');
export const READINESS_PROBES = Symbol('ReadinessProbes');
export const LISTING_PORT = Symbol('ListingPort');
export const ADDON_TEMPLATE_REPOSITORY = Symbol('AddonTemplateRepository');
export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');
export const CATEGORY_PLACEMENT_REPOSITORY = Symbol('CategoryPlacementRepository');
export const ATTRIBUTE_DEFINITION_REPOSITORY = Symbol('AttributeDefinitionRepository');
export const CURRENCY_REPOSITORY = Symbol('CurrencyRepository');
export const PROMOTION_REPOSITORY = Symbol('PromotionRepository');
export const CART_REPOSITORY = Symbol('CartRepository');
export const ORDER_REPOSITORY = Symbol('OrderRepository');
export const DASHBOARD_REPOSITORY = Symbol('DashboardRepository');
export const CUSTOMER_REPOSITORY = Symbol('CustomerRepository');
export const ADMIN_USER_REPOSITORY = Symbol('AdminUserRepository');
export const AUTH_PORT = Symbol('AuthPort');
export const TRANSACTION_MANAGER = Symbol('TransactionManagerPort');
export const AUTH_SESSION_REPOSITORY = Symbol('AuthSessionRepository');
export const CUSTOMER_AUTH_REPOSITORY = Symbol('CustomerAuthRepository');
export const PENDING_SIGNUP_REPOSITORY = Symbol('PendingSignupRepository');
export const PENDING_CONTACT_CHANGE_REPOSITORY = Symbol('PendingContactChangeRepository');
export const AUTH_IDENTITY_REPOSITORY = Symbol('AuthIdentityRepository');
export const ADMIN_USER_AUTH_REPOSITORY = Symbol('AdminUserAuthRepository');
export const OTP_CHALLENGE_REPOSITORY = Symbol('OtpChallengeRepository');
export const PASSWORD_RESET_TOKEN_REPOSITORY = Symbol('PasswordResetTokenRepository');
export const EMAIL_VERIFICATION_TOKEN_REPOSITORY = Symbol('EmailVerificationTokenRepository');
export const ADMIN_INVITE_REPOSITORY = Symbol('AdminInviteRepository');
export const AUTH_RATE_LIMIT_REPOSITORY = Symbol('AuthRateLimitRepository');
export const OAUTH_STATE_REPOSITORY = Symbol('OauthStateRepository');
export const NOTIFICATION_PORT = Symbol('NotificationPort');
export const STORAGE_PORT = Symbol('StoragePort');
/** The INR gateway role. Which vendor fills it is decided only where this token is bound. */
export const INR_PAYMENT_GATEWAY = Symbol('InrPaymentGateway');
export const NOTIFICATION_SETTINGS_REPOSITORY = Symbol('NotificationSettingsRepository');
export const NOTIFICATION_TEMPLATE_REPOSITORY = Symbol('NotificationTemplateRepository');
export const MESSAGE_OUTBOX_REPOSITORY = Symbol('MessageOutboxRepository');
export const CONSENT_REPOSITORY = Symbol('ConsentRepository');
export const AUDIT_LOG_REPOSITORY = Symbol('AuditLogRepository');
export const ROLE_REPOSITORY = Symbol('RoleRepository');
export const ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY = Symbol('AdminUserRoleAssignmentRepository');
export const MEDIA_ASSET_REPOSITORY = Symbol('MediaAssetRepository');
export const MEDIA_ROLE_REPOSITORY = Symbol('MediaRoleRepository');
export const MEDIA_PROFILE_REPOSITORY = Symbol('MediaProfileRepository');
/** Email pictures whose photo is gone, kept for good (media step 3f). */
export const EMAIL_PICTURE_REPOSITORY = Symbol('EmailPictureRepository');
/** The four legal pages and their earlier versions (Legal Pages brief). */
export const LEGAL_PAGE_REPOSITORY = Symbol('LegalPageRepository');
export const PRODUCT_DRAFT_REPOSITORY = Symbol('ProductDraftRepository');
/** Page Builder: pages' schedules, layouts and their revisions; saved blocks (2026-11-17). */
export const PAGE_LAYOUT_REPOSITORY = Symbol('PageLayoutRepository');
/** Preview codes and sessions (Page Builder step 6), kept on the layout records by the same adapter. */
export const PREVIEW_TOKEN_REPOSITORY = Symbol('PreviewTokenRepository');
export const SAVED_BLOCK_REPOSITORY = Symbol('SavedBlockRepository');
export const CONTENT_BLOCK_REPOSITORY = Symbol('ContentBlockRepository');
export const SITE_SETTINGS_REPOSITORY = Symbol('SiteSettingsRepository');
export const SEARCH_ANALYTICS_REPOSITORY = Symbol('SearchAnalyticsRepository');
export const SEARCH_TERM_REPOSITORY = Symbol('SearchTermRepository');
export const REVIEW_REPOSITORY = Symbol('ReviewRepository');
export const MEDIA_JOB_QUEUE = Symbol('MediaJobQueuePort');
export const CDN_PURGE = Symbol('CdnPurgePort');
export const YOUTUBE_PORT = Symbol('YouTubePort');
export const BLOG_POST_REPOSITORY = Symbol('BlogPostRepository');
export const SHOP_EVENT_REPOSITORY = Symbol('ShopEventRepository');
/** Running sale prices in memory, laid over shop reads (owner log § launch and sale events). */
export const SALE_PRICE_BOOK = Symbol('SalePriceBook');
export const BLOG_CATEGORY_REPOSITORY = Symbol('BlogCategoryRepository');
export const BLOG_TAG_REPOSITORY = Symbol('BlogTagRepository');
export const STORE_LOCATION_REPOSITORY = Symbol('StoreLocationRepository');
export const SHIPPING_RULE_REPOSITORY = Symbol('ShippingRuleRepository');
export const COMMUNICATION_SWITCH_REPOSITORY = Symbol('CommunicationSwitchRepository');
export const LANGUAGE_REPOSITORY = Symbol('LanguageRepository');
/** The Media page (step 1). */
export const MEDIA_FOLDER_REPOSITORY = Symbol('MediaFolderRepository');
export const MEDIA_FAVOURITE_REPOSITORY = Symbol('MediaFavouriteRepository');
export const SHARE_LINK_REPOSITORY = Symbol('ShareLinkRepository');
export const STORAGE_LEDGER_REPOSITORY = Symbol('StorageLedgerRepository');
export const MEDIA_ZIP_REPOSITORY = Symbol('MediaZipRepository');
export const MEDIA_BROWSE_REPOSITORY = Symbol('MediaBrowseRepository');
/** A photo's swatch cuts (brief P11): the media repository's own lookup. */
export const MEDIA_CUT_REPOSITORY = Symbol('MediaCutRepository');
export const LANGUAGE_COVERAGE_REPOSITORY = Symbol('LanguageCoverageRepository');
/** Gmail mailboxes in the admin and Contact Us delivery (owner log § stores, Contact Us and Gmail mailboxes). */
export const MAILBOX_PORT = Symbol('MailboxPort');
export const MAILBOX_REPOSITORY = Symbol('MailboxRepository');
export const MAILBOX_ACCESS_REPOSITORY = Symbol('MailboxAccessRepository');
export const MAILBOX_TOKEN_STORE = Symbol('MailboxTokenStore');
export const CONTACT_MESSAGE_REPOSITORY = Symbol('ContactMessageRepository');
export const MAILBOX_OUTBOX_REPOSITORY = Symbol('MailboxOutboxRepository');
export const SAVED_REPLY_REPOSITORY = Symbol('SavedReplyRepository');
export const WISHLIST_REPOSITORY = Symbol('WishlistRepository');
/** Purchases and stock (brief revision 2, accepted 2026-11-15). */
export const SUPPLIER_REPOSITORY = Symbol('SupplierRepository');
export const SUPPLIER_ITEM_CODE_REPOSITORY = Symbol('SupplierItemCodeRepository');
export const PURCHASE_ORDER_REPOSITORY = Symbol('PurchaseOrderRepository');
export const PURCHASE_ENTRY_REPOSITORY = Symbol('PurchaseEntryRepository');
export const SUPPLIER_PAYMENT_REPOSITORY = Symbol('SupplierPaymentRepository');
export const PURCHASE_RETURN_REPOSITORY = Symbol('PurchaseReturnRepository');
export const STOCK_HOLD_REPOSITORY = Symbol('StockHoldRepository');
export const ADJUSTMENT_REQUEST_REPOSITORY = Symbol('AdjustmentRequestRepository');
export const STOCK_COUNT_REPOSITORY = Symbol('StockCountRepository');
export const OPENING_STOCK_REPOSITORY = Symbol('OpeningStockRepository');
export const NUMBER_ALLOCATOR = Symbol('NumberAllocatorPort');
export const INVENTORY_SETTINGS_REPOSITORY = Symbol('InventorySettingsRepository');
export const SHOP_DETAILS_REPOSITORY = Symbol('ShopDetailsRepository');
/** Company setup (accounts brief J, CT, G1–G2). */
export const COMPANY_REPOSITORY = Symbol('CompanyRepository');
export const EDOC_REPOSITORY = Symbol('EDocRepository');
export const EDOC_KEY_STORE = Symbol('EDocKeyStore');
export const LOCATION_REPOSITORY = Symbol('LocationRepository');
/** The general ledger (accounts brief Q, T, D10). */
export const GENERAL_LEDGER_REPOSITORY = Symbol('GeneralLedgerRepository');
export const PERIOD_LOCK_REPOSITORY = Symbol('PeriodLockRepository');
export const DOCUMENT_LOCK_REPOSITORY = Symbol('DocumentLockRepository');
export const GST_RETURN_REPOSITORY = Symbol('GstReturnRepository');
export const TAX_INVOICE_REPOSITORY = Symbol('TaxInvoiceRepository');
/** Returns, credit notes and debit notes (accounts brief B). */
export const ORDER_RETURN_REPOSITORY = Symbol('OrderReturnRepository');
export const CREDIT_NOTE_REPOSITORY = Symbol('CreditNoteRepository');
export const DEBIT_NOTE_REPOSITORY = Symbol('DebitNoteRepository');
export const REFUND_VOUCHER_REPOSITORY = Symbol('RefundVoucherRepository');
/** Accounts templates and what the books were installed from (accounts templates T2). */
export const ACCOUNTS_TEMPLATE_REPOSITORY = Symbol('AccountsTemplateRepository');
export const TEMPLATE_INSTALL_REPOSITORY = Symbol('TemplateInstallRepository');
/** Accounts › Vouchers and the Day book read over every document (accounts brief A). */
export const ACCOUNTS_LISTS_READER = Symbol('AccountsListsReader');
/** Self-invoices and payment vouchers (accounts brief D). */
export const SELF_INVOICE_REPOSITORY = Symbol('SelfInvoiceRepository');
/** Cash boxes, sheets, petty expenses and claims (accounts brief O). */
export const CASH_REPOSITORY = Symbol('CashRepository');
export const TRANSFER_REPOSITORY = Symbol('TransferRepository');
export const BANK_REPOSITORY = Symbol('BankRepository');
export const BANK_STATEMENT_REPOSITORY = Symbol('BankStatementRepository');
export const SETTLEMENT_REPOSITORY = Symbol('SettlementRepository');
export const GST_RETURN_DRAFT_REPOSITORY = Symbol('GstReturnDraftRepository');
export const GSTR2B_REPOSITORY = Symbol('Gstr2bRepository');
export const GST_ANNUAL_NOTE_REPOSITORY = Symbol('GstAnnualNoteRepository');
export const REPORT_DEFINITION_REPOSITORY = Symbol('ReportDefinitionRepository');
export const FIXED_ASSET_REPOSITORY = Symbol('FixedAssetRepository');
export const RECURRING_ENTRY_REPOSITORY = Symbol('RecurringEntryRepository');
export const EMPLOYEE_REPOSITORY = Symbol('EmployeeRepository');
export const ATTENDANCE_REPOSITORY = Symbol('AttendanceRepository');
export const PAYROLL_RUN_REPOSITORY = Symbol('PayrollRunRepository');
export const PAYROLL_RULES_REPOSITORY = Symbol('PayrollRulesRepository');
export const SALARY_TEMPLATE_REPOSITORY = Symbol('SalaryTemplateRepository');
export const STATUTORY_FILING_REPOSITORY = Symbol('StatutoryFilingRepository');
export const PAYROLL_ADVANCE_REPOSITORY = Symbol('PayrollAdvanceRepository');
export const YEAR_CLOSE_REPOSITORY = Symbol('YearCloseRepository');
export const EXPENSE_BILL_REPOSITORY = Symbol('ExpenseBillRepository');
export const BOOKS_IMPORT_REPOSITORY = Symbol('BooksImportRepository');
export const PAYMENT_VOUCHER_REPOSITORY = Symbol('PaymentVoucherRepository');
/** Where money lands (Postings and Convert brief AP-D1). */
export const MONEY_LANDING_REPOSITORY = Symbol('MoneyLandingRepository');
export const STOCK_MOVEMENT = Symbol('StockMovementPort');
export const STOCK_READ_REPOSITORY = Symbol('StockReadRepository');
export const INVENTORY_COST_LAYER_REPOSITORY = Symbol('InventoryCostLayerRepository');
/** Business documents as PDF (owner decision 2026-11-17: Chromium through Playwright). */
export const DOCUMENT_RENDERER = Symbol('DocumentRendererPort');
export const DOCUMENT_FORMAT_REPOSITORY = Symbol('DocumentFormatRepository');
/** Read-only counts of the background queues, for the operations address (`/ops`). */
export const QUEUE_STATS = Symbol('QueueStatsPort');
/** Orders and checkout (brief approved 2026-11-20). */
export const ADMIN_ORDER_REPOSITORY = Symbol('AdminOrderRepository');
export const ORDER_PAYMENT_REPOSITORY = Symbol('OrderPaymentRepository');
export const PAYMENT_REQUEST_REPOSITORY = Symbol('PaymentRequestRepository');
export const PAYMENT_ATTEMPT_REPOSITORY = Symbol('PaymentAttemptRepository');
export const SHIPMENT_REPOSITORY = Symbol('ShipmentRepository');
export const BUSINESS_REPOSITORY = Symbol('BusinessRepository');
export const LEDGER_REPOSITORY = Symbol('LedgerRepository');
export const PRICE_ZONE_REPOSITORY = Symbol('PriceZoneRepository');
export const COUPON_REPOSITORY = Symbol('CouponRepository');
export const DOCUMENT_NUMBERING_REPOSITORY = Symbol('DocumentNumberingRepository');
export const ORDER_SETTINGS_REPOSITORY = Symbol('OrderSettingsRepository');
export const GEO_DATA_PORT = Symbol('GeoDataPort');
export const EINVOICE_PORT = Symbol('EInvoicePort');
export const EWAYBILL_PORT = Symbol('EWayBillPort');
/** The gateways' own payment requests, by gateway (CCAvenue Quick Invoice, PayPal Invoicing). */
export const PAYMENT_REQUEST_PORTS = Symbol('PaymentRequestPorts');
export const CHECKOUT_GATEWAYS = Symbol('CheckoutGateways');

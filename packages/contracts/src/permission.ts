import { z } from 'zod';

/**
 * The canonical permission registry.
 *
 * ## Why a registry at all
 *
 * Permissions were `z.array(z.string())` everywhere: an invite could grant `prodcut.index`
 * and the system would accept it, store it, and silently authorize nothing. There was no
 * enumeration to build a grant UI from, and no way to tell a retired code from a typo. A
 * closed set fixes all three — an unknown code is now rejected where it is granted, and
 * `RequirePermissions` in the API takes this union, so a mistyped code fails to COMPILE
 * rather than failing open at runtime.
 *
 * ## Where the codes come from
 *
 * Navigation codes from `apps/admin/src/app/shared/data/menu.ts`, in-page UI gates
 * (`*hasPermission`, table row actions), and server-only administrative surfaces.
 * `scripts/check-permission-registry.mjs` holds menu ↔ registry agreement together.
 *
 * ## What is deliberately absent
 *
 * There is no `admin_user.destroy` for operators: they are deactivated, never deleted, because an
 * audit trail that can lose its subject is not an audit trail. Storefront customers use
 * soft-delete via `customer.destroy` (`status: deleted`) so email/phone can be reclaimed, and
 * `customer.restore` (`DEC-CUSTOMER-SOFT-DELETE-OPS`) both opens that recycle bin and undoes a delete.
 *
 * There is no bare `user.*` family. That noun meant two populations at once, which is the
 * defect `DEC-ACCOUNT-SEPARATION` existed to remove; operators are `admin_user.*`, shoppers
 * are `customer.*`. Nor is there marketplace vocabulary — `vendor_wallet.*`,
 * `commission_history.*`, `wallet.*` — because this is a single-vendor business and a
 * grantable code for a role that cannot exist is a grant screen lying to whoever reads it.
 *
 * ## How it is allowed to change
 *
 * This is a CLOSED, owner-locked set. Adding or removing a code is an owner decision, not an
 * implementation detail, and every entry below carries a justification naming the surface it
 * actually guards. An earlier revision of this comment claimed the registry "grows one route
 * at a time"; it then grew by 63 codes in a single pass while 64 entries shared one generated
 * justification. Both were corrected on 2026-08-15. If a justification you are about to write
 * would fit any other code with the name swapped, the entry does not belong here yet.
 */
export const PermissionCode = z.enum([
	'admin_user_role.assign',
	'admin_user_role.revoke',
	'admin_user.create',
	'admin_user.index',
	'admin_user.update',
	'attachment.create',
	'attachment.destroy',
	'attachment.edit',
	'attachment.index',
	'attribute.create',
	'attribute.destroy',
	'attribute.edit',
	'attribute.index',
	'audit.index',
	'blog.create',
	'blog.destroy',
	'blog.edit',
	'blog.index',
	'business.approve',
	'business.assign',
	'business.create',
	'business.credit',
	'business.edit',
	'business.hold',
	'business.index',
	'business.settle',
	'cart.index',
	'category.create',
	'category.destroy',
	'category.edit',
	'category.index',
	'company.edit',
	'coupon.create',
	'coupon.destroy',
	'coupon.edit',
	'coupon.index',
	'currency.create',
	'currency.destroy',
	'currency.edit',
	'currency.index',
	'customer.create',
	'customer.destroy',
	'customer.index',
	'customer.restore',
	'customer.update',
	'dashboard.customers',
	'dashboard.orders',
	'dashboard.revenue',
	'dashboard.reviews',
	'dashboard.stock',
	'dashboard.top_products',
	'event.cancel',
	'event.create',
	'event.destroy',
	'event.edit',
	'event.index',
	'event.publish',
	'faq.create',
	'faq.destroy',
	'faq.edit',
	'faq.index',
	'language.manage',
	'mailbox.manage',
	'mailbox.use',
	'order.address',
	'order.create',
	'order.edit',
	'order.index',
	'order.open',
	'order.payment',
	'order.send',
	'order.update',
	'page_builder.draft_home',
	'page_builder.go_live',
	'page_builder.go_live_home',
	'page.create',
	'page.destroy',
	'page.edit',
	'page.index',
	'permission.index',
	'point.credit',
	'point.debit',
	'point.index',
	'price_zone.create',
	'price_zone.destroy',
	'price_zone.edit',
	'price_zone.index',
	'product.create',
	'product.destroy',
	'product.edit',
	'product.index',
	'purchase_order.cancel',
	'purchase_order.create',
	'purchase_order.index',
	'purchase_order.send',
	'purchase_return.create',
	'purchase_return.index',
	'purchase_return.send',
	'purchase_return.settle',
	'purchase.check',
	'purchase.create',
	'purchase.index',
	'purchase.payment',
	'purchase.post',
	'purchase.void',
	'question_and_answer.create',
	'question_and_answer.destroy',
	'question_and_answer.edit',
	'question_and_answer.index',
	'refund.action',
	'refund.create',
	'refund.index',
	'review.create',
	'review.destroy',
	'review.edit',
	'review.index',
	'role.create',
	'role.destroy',
	'role.index',
	'role.update',
	'search_term.create',
	'search_term.destroy',
	'search_term.edit',
	'search_term.index',
	'setting.edit',
	'setting.index',
	'shipping.create',
	'shipping.destroy',
	'shipping.edit',
	'shipping.index',
	'shop_details.edit',
	'stock_count.count',
	'stock_count.create',
	'stock_count.post',
	'stock_report.export',
	'stock_report.index',
	'stock.adjust',
	'stock.approve',
	'stock.cost',
	'stock.hold',
	'stock.index',
	'stock.opening',
	'supplier.create',
	'supplier.destroy',
	'supplier.edit',
	'supplier.index',
	'tag.create',
	'tag.destroy',
	'tag.edit',
	'tag.index',
	'tax.create',
	'tax.destroy',
	'tax.edit',
	'tax.index',
	'theme_option.edit',
	'theme_option.index',
	'withdraw_request.action',
]);
export type PermissionCode = z.infer<typeof PermissionCode>;

/** Every code, for building a grant UI or asserting completeness. Ordering is stable. */
export const PERMISSION_CODES: readonly PermissionCode[] = PermissionCode.options;

/**
 * Codes no navigation entry gates on, each with the reason it exists anyway.
 *
 * Most are the finer half of a resource: `menu.ts` lists coarse index/create parents, while
 * the create button, the table row action and the tree-node control live inside the page.
 * A handful guard a server route with no screen at all (`audit.index`, `cart.index`,
 * `permission.index`, `order.update`).
 *
 * Each justification must name the SURFACE — the file, the control — so the entry can be
 * re-checked against reality later. A sentence that would read the same for any other code
 * with the name substituted answers nothing; that is what this map looked like before
 * 2026-08-15, and it let 64 entries pass a guard none of them satisfied. A few entries below
 * honestly say "reserved, nothing gates this yet" for kept pages awaiting an API. That is a
 * real answer. A template is not.
 */
export const SERVER_ONLY_PERMISSION_CODES: Readonly<Partial<Record<PermissionCode, string>>> = {
	'business.approve':
		"Allow an order on account over a business's credit limit, once, with a reason (brief K9, ck06; POST /admin/orders with creditOverrideReason). Super admin by default; separate from business.credit so setting a limit and exceeding it are different grants.",
	'business.assign':
		'Zone field on the business form and the business list (DEC-B2B-ZONES, owner 2026-11-20: "permission to assign"); PUT /admin/businesses/:id/zone.',
	'business.create': 'Add business on Customers › Businesses (brief bz02); POST /admin/businesses.',
	'business.credit':
		"Credit limit and credit days on the business form's Buys from us block (bz02); the fields are read-only without it.",
	'business.edit':
		'Business page Edit and the form Save (bz02), its addresses and contacts; PUT /admin/businesses/:id.',
	'business.hold':
		'Change standing on the business page (bz05): Active, Credit on hold, Blocked, with a reason; POST /admin/businesses/:id/standing.',
	'business.settle':
		"Record a set-off between a business's two accounts under a written agreement, and its reversal (so02–so04); POST /admin/businesses/:id/set-offs. Off for Saha Textile.",
	'order.address':
		'Add the invoice address on an order with "Invoice address needed" (od04); POST /admin/orders/:id/invoice-address.',
	'order.open':
		'Keep an admin order open, add and remove its pieces, and close it (brief oo01–oo08); the open-order routes under /admin/orders/:id/lines.',
	'order.payment':
		'Record payment on the order page and the admin checkout (ck03–ck05, oo03–oo05, od08); POST /admin/orders/:id/payments.',
	'order.send':
		'Request online payment, Resend, Cancel, Send as SMS and Send as email on a payment request (pl01–pl05, pr01, pr02, oo07); /admin/orders/:id/payment-requests.',
	'price_zone.create': 'New zone on Customers › Zones (DEC-B2B-ZONES); POST /admin/zones.',
	'price_zone.destroy':
		'Delete on a zone that no business uses; RETAIL can never be deleted (DELETE /admin/zones/:id).',
	'price_zone.edit': 'Zone price list editing, Go live and the zone settings (DEC-B2B-ZONES); PUT /admin/zones/:id.',
	'dashboard.customers':
		'Total Customers tile on the admin home page (dashboard.html, GET /admin/dashboard/customers). The tile is a count only, so it is separate from customer.index, which opens personal records.',
	'dashboard.orders':
		'Total Orders tile and Recent Orders table on the admin home page (dashboard.html, GET /admin/dashboard/orders and /orders/recent). Separate from order.index so home page access can be set apart from the Orders page.',
	'dashboard.revenue':
		'Total Revenue tile and Monthly Revenue chart on the admin home page (dashboard.html, GET /admin/dashboard/revenue and /revenue/monthly). Its own code so money can be hidden from staff who still see order counts.',
	'dashboard.reviews':
		'Latest Reviews panel on the admin home page (dashboard.html, GET /admin/dashboard/reviews). Read-only: moderating stays on review.edit.',
	'page_builder.go_live':
		'Go Live, Schedule, Put back and Cancel a switch in the Page Builder (pb-go-live.html, POST /admin/page-builder/layouts/:id/go-live), on every page. Drafts stay on theme_option.edit, so staff can build and Ask for review while only the owner and super admins change what shoppers see (Page Builder Q10 A).',
	'page_builder.draft_home':
		'Build drafts of the Home page only in the Page Builder (layouts, the builder, Page settings, import, Ask for review), for a role without theme_option.edit, which drafts every page (Page Builder SG-19).',
	'page_builder.go_live_home':
		'Go Live, Schedule, Put back and Cancel a switch on the Home page only, for a role without page_builder.go_live, which covers every page (Page Builder SG-19).',
	'dashboard.stock':
		'Product Stock Report on the admin home page (dashboard.html, GET /admin/dashboard/stock). Row Edit still needs product.edit.',
	'dashboard.top_products':
		'Top Selling Products panel on the admin home page (dashboard.html, GET /admin/dashboard/top-products). It shows sales figures per product, so it is separate from dashboard.stock.',
	'admin_user_role.assign':
		'Granting authority (auth pass 5c.4) on the operator edit screen (form-user.html). Deliberately not part of admin_user.update: editing a colleague and enlarging their authority are different risks.',
	'admin_user_role.revoke':
		'Removing authority on the operator edit screen (form-user.html). Separate from assigning it because offboarding must stay possible for an operator who may not grant.',
	'admin_user.update':
		'Administrative operator editing (auth pass 5c.4), distinct from inviting a new one. Navigation gates create/index only.',
	'attachment.create':
		'Upload control on the Media library and on the media-picker modal (media.html, media-modal.html). menu.ts carries no Media entry, so this is reachable only in-page.',
	'attachment.destroy':
		'Delete control on the Media library and on the media-box thumbnail (media.html, media-box.html). No Media navigation entry exists to gate.',
	'attachment.edit':
		'Media library SEO edits (slug, alt, title, caption) and the Reprocess action (PATCH /admin/media/:id, POST /admin/media/:id/reprocess). No Media navigation entry exists to gate.',
	'attribute.create':
		'Add-attribute button on the Attributes page. menu.ts gates attribute.index beneath Products; creation is in-page only.',
	'attribute.destroy':
		'Attributes table row Delete action, configured in attribute.ts. Row actions never appear in navigation.',
	'attribute.edit':
		'Attributes table row Edit action, configured in attribute.ts. The Fastkart-era .edit spelling is kept because the row action still sends it.',
	'audit.index':
		'Reads the audit trail every admin mutation writes (GET /admin/audit-logs). Deliberately its own code rather than folded into admin_user.index or setting.index. No screen gates it yet.',
	'blog.create': 'Add-blog button on the Blog page. menu.ts gates blog.index only.',
	'blog.destroy': 'Blog table row Delete action (blog.ts).',
	'blog.edit': 'Blog table row Edit action (blog.ts).',
	'cart.index':
		'Support-read of a customer cart (DEC-ACCOUNT-SEPARATION D4). Coarse staff/admin role must not bypass ownership; this server-only code is the only support path. No navigation entry yet.',
	'category.create':
		'Add-category button on the Categories page, which is reached from Products rather than from its own navigation entry.',
	'category.destroy': 'Delete control on a single category tree node (tree-node.html), not a page-level button.',
	'category.edit': 'Edit control on a single category tree node (tree-node.html).',
	'coupon.create': 'Add-coupon button on the Coupons page. No Coupon navigation entry exists.',
	'coupon.destroy': 'Coupons table row Delete action (coupon.ts).',
	'coupon.edit': 'Coupons table row Edit action (coupon.ts).',
	'currency.create': 'Add-currency button on the Currency page, reached from Settings rather than from navigation.',
	'currency.destroy': 'Currency table row Delete action (currency.ts).',
	'currency.edit': 'Currency table row Edit action (currency.ts).',
	'customer.destroy':
		'Admin Customer CRM soft-delete (status deleted). Separate from update so directory editors need not hold irreversible offboarding. Menu gates create/index only.',
	'customer.restore':
		'Deleted filter on the Customer CRM list and its Restore row action (DEC-CUSTOMER-SOFT-DELETE-OPS). Also the only code that lists deleted customers at the API. Menu gates create/index only.',
	'customer.update':
		'Admin Customer CRM profile/address edits and activation resend. Menu gates create/index only; edit screens check this code at the API.',
	'event.cancel':
		'Cancel and End now on a published launch or sale (events list and form). Kept apart from edit because it stops a running sale for every shopper.',
	'event.destroy': 'Events table row Delete action, offered on drafts only; a published event is cancelled instead.',
	'event.edit': 'Events table row Edit action and the event form Save (events.ts, event form).',
	'event.publish':
		'Publish and Unpublish on the event form. Separate from edit so a staff member can prepare an event that only the owner sends to customers and the shop.',
	'faq.create': 'Add-FAQ button on the FAQ page. No FAQ navigation entry exists.',
	'faq.destroy': 'FAQ table row Delete action (faq.ts).',
	'faq.edit': 'FAQ table row Edit action (faq.ts).',
	'order.edit':
		"Order table row Edit action on both the Orders page and the dashboard's recent-orders table (order.ts, dashboard.ts). Navigation gates order.index and order.create only.",
	'order.update':
		'Changing an order status (PATCH /orders/:id/status). Navigation gates order.index and order.create only.',
	'page.create': 'Add-page button on the Pages screen. No Pages navigation entry exists.',
	'page.destroy': 'Pages table row Delete action (page.ts).',
	'page.edit': 'Pages table row Edit action (page.ts).',
	'permission.index': 'Enumerates this registry so a grant UI can render it; there is no screen of its own to gate.',
	'point.credit':
		"Add-points control on the Points page and on the customer ledger's points panel (point.html, customer-ledger.html). Neither screen has an API yet; the gate is what will authorise it when they do.",
	'point.debit':
		"Withdraw-points control on the Points page and on the customer ledger's points panel (point.html, customer-ledger.html). Inert until those screens are wired.",
	'product.destroy': 'Products table row Delete action (product.ts).',
	'product.edit':
		"Product row Edit action on the Products page and on the dashboard's product tables (product.ts, dashboard.ts). Navigation gates product.index and product.create only.",
	'purchase.check':
		'Check goods on a purchase entry (p08 desktop, g01 phone) and POST /admin/purchases/entries/:id/goods-check. Separate from create so godown staff can count a parcel without typing bills (brief X01).',
	'purchase.create':
		'New entry, Copy as new draft, Import lines and Make a draft product on the purchase entries screens (p01–p05, p13), and draft saves (POST/PUT /admin/purchases/entries). Navigation gates purchase.index only.',
	'purchase.payment':
		'Record payment on a purchase entry and on the supplier page (p11, s03), and reversing one (POST /admin/purchases/entries/:id/payments). Money out is its own grant.',
	'purchase.post':
		'Post to stock on a checked purchase entry (p09) and POST /admin/purchases/entries/:id/post: the step that moves stock, cost and what is owed.',
	'purchase.void':
		'Void on a posted purchase entry (p10, p12) and POST /admin/purchases/entries/:id/void. Restricted: it takes stock back out and cancels what is owed.',
	'purchase_order.cancel':
		'Close with what is short and Cancel order on a purchase order (po04) and POST /admin/purchase-orders/:id/close and /cancel.',
	'purchase_order.create':
		'New purchase order, Copy as new draft, edits to a draft, and the reorder list making draft orders (po01, po02, i07); POST/PUT /admin/purchase-orders.',
	'purchase_order.send':
		'Send to the supplier by email or PDF (po03) and POST /admin/purchase-orders/:id/send. Separate from create so an order can be prepared and sent by someone else.',
	'purchase_return.create':
		'New return from a posted entry, from Held stock and from the ageing report (r02, i06, i08); POST/PUT /admin/purchase-returns.',
	'purchase_return.send':
		'Send on a purchase return (r04) and POST /admin/purchase-returns/:id/send: gives the debit note its number and takes the goods out of stock.',
	'purchase_return.settle':
		'Settle on a sent purchase return (r04) and POST /admin/purchase-returns/:id/settle: records the credit note, refund, later-bill deduction or write-off.',
	'stock.adjust':
		'Adjust stock window from All stock, Stock history and the product Inventory tab (i04, f01) and POST /admin/stock/adjustments. Without stock.approve every write-off becomes a request (P2).',
	'stock.cost':
		'Every cost and stock-value column, the Cost layers tab, margin on purchase lines and report values (i01, i03, p06, i08, i09). The API leaves these fields out entirely without it (P8).',
	'stock.hold':
		'Move to held and Release in the Adjust window and on Held stock (i04, i06); POST /admin/stock/adjustments with hold or release. Holds never need approval.',
	'stock_count.create':
		'Start a count on the counts list (c01, c02) and POST /admin/stock-counts. Counting itself is stock_count.count.',
	'stock_count.post':
		'Review differences, Recount and Post on a count (c03) and POST /admin/stock-counts/:id/post. Without stock.approve a posted count waits for approval (P2).',
	'stock_report.export':
		'Excel and PDF downloads on the stock reports (i08, i09, i10) and GET /admin/stock-reports/*/export. Seeing a report and taking a copy away are separate grants.',
	'supplier.create': 'Add supplier on the Suppliers list (s01, s02) and POST /admin/suppliers.',
	'supplier.destroy':
		'Suppliers table row Delete action (s01) and DELETE /admin/suppliers/:id: a soft delete, refused while the supplier has purchase entries.',
	'supplier.edit':
		'Suppliers table row Edit action and the supplier form Save (s01, s02) and PUT /admin/suppliers/:id.',
	'question_and_answer.create':
		'Reserved for the kept Questions & Answers page, which has no create surface or API yet. Retained so the code exists when that page is wired; nothing gates on it today.',
	'question_and_answer.destroy':
		'Questions & Answers table row Delete action (questions-answers.ts). Corrected from store.destroy, which had let a Store grant carry Q&A authority.',
	'question_and_answer.edit':
		'Questions & Answers table row Edit action (questions-answers.ts). Corrected from store.edit, which had let a Store grant carry Q&A authority.',
	'question_and_answer.index':
		'Reserved for the kept Questions & Answers page. menu.ts has no Q&A entry and the page has no API yet; nothing gates on it today.',
	'refund.action':
		'Reserved for the kept Refund page, which has no API yet. The payout modal that page opens gates on withdraw_request.action instead; nothing gates on this code today.',
	'refund.create': 'Reserved for the kept Refund page. Nothing gates on it until that page is wired.',
	'review.create':
		'Reserved for the kept Reviews page, which exposes no create surface today; only review.destroy is gated there.',
	'review.destroy': 'Reviews table row Delete action (review.ts).',
	'review.edit':
		'Review moderation: Approve publishes the review and its photos, Reject deletes the photos (POST /admin/reviews/:id/moderation). Row action only; navigation gates review.index.',
	'role.create': 'Role management surface (auth pass 5c.3); the navigation gates only role.index today.',
	'role.destroy': 'Role management surface (auth pass 5c.3); deleting a role is separate from editing one.',
	'role.update': 'Role management surface (auth pass 5c.3); editing a role changes what everyone holding it can do.',
	'search_term.create': 'Add-search-word button on the Search words page.',
	'search_term.destroy': 'Search words table row Delete action (search-term.ts).',
	'search_term.edit':
		"Search word form Save, and the list's bulk Go Live and Take off shop (POST /admin/search-terms/status).",
	'setting.edit':
		'Every write on the settings surfaces: the Save control on the main Settings page, and the two audited notification mutations (PATCH /admin/notifications/channels, PUT /admin/notifications/templates). Reads use setting.index, which is the navigation code; writes deliberately do not.',
	'shipping.create':
		'New rule set and Add exception on Admin › Shipping; POST /admin/shipping/rule-sets and /exceptions.',
	'shop_details.edit':
		'The open boxes and Save on Settings › Shop details (X04) and PUT /admin/settings/shop-details: the legal name, GSTIN and address printed on business documents. Reading the page is setting.index (read only, X04D). Held by the Administrator role.',
	'company.edit':
		'Save on Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2) and PUT /admin/company, /admin/company/registrations, /admin/company/features. Reading them is setting.index. Held by the Administrator role.',
	'shipping.destroy': 'Delete an own rule set not used anywhere, or remove an exception (Admin › Shipping).',
	'shipping.edit': 'Save and make active a rule set, change an exception, save the zone settings (Admin › Shipping).',
	'tag.create': 'Add-tag button on the Tags page, reached from Products rather than from navigation.',
	'tag.destroy': 'Tags table row Delete action (tag.ts).',
	'tag.edit': 'Tags table row Edit action (tag.ts).',
	'tax.create': 'Add-tax button on the Tax page, reached from Settings rather than from navigation.',
	'tax.destroy': 'Tax table row Delete action (tax.ts).',
	'tax.edit': 'Tax table row Edit action (tax.ts).',
	'theme_option.edit': 'Save control on the Theme Options page. menu.ts gates theme_option.index only.',
	'withdraw_request.action':
		'Approve/reject control inside the payout modal (payout-modal.html), which the Refund page opens. Not a page of its own, so it has no navigation entry.',
};

/** The resource half of a code — the noun a permission is about. */
export const PermissionResource = z.enum([
	'admin_user',
	'admin_user_role',
	'attachment',
	'attribute',
	'audit',
	'blog',
	'business',
	'cart',
	'category',
	'company',
	'coupon',
	'currency',
	'customer',
	'dashboard',
	'event',
	'faq',
	'language',
	'mailbox',
	'order',
	'page',
	'page_builder',
	'permission',
	'point',
	'price_zone',
	'product',
	'purchase',
	'purchase_order',
	'purchase_return',
	'question_and_answer',
	'refund',
	'review',
	'role',
	'search_term',
	'setting',
	'shipping',
	'shop_details',
	'stock',
	'stock_count',
	'stock_report',
	'supplier',
	'tag',
	'tax',
	'theme_option',
	'withdraw_request',
]);
export type PermissionResource = z.infer<typeof PermissionResource>;

/**
 * The action half. Extending this is a registry decision, not an implementation detail.
 *
 * `assign` and `revoke` are separate actions rather than one `manage`, because granting
 * authority and removing it carry opposite risks. `edit` remains alongside `update` where a
 * kept admin screen still sends the Fastkart-era `.edit` string from a table row action;
 * `update` is what the API's own routes use. `credit` and `debit` cover the points controls,
 * `action` covers the payout approve/reject chrome, and `restore` undoes a soft delete — kept
 * apart from `destroy` and `update` so bringing a departed customer back is its own grant
 * (`DEC-CUSTOMER-SOFT-DELETE-OPS`). `customers`, `orders`, `revenue`, `reviews`, `stock` and
 * `top_products` belong to the `dashboard` resource alone: each names one widget on the admin
 * home page, so a super admin can grant that widget by itself (`DEC-ADMIN-HOME-WIDGETS`).
 */
export const PermissionAction = z.enum([
	'action',
	'address',
	'adjust',
	'approve',
	'assign',
	'cancel',
	'check',
	'cost',
	'count',
	'create',
	'credit',
	'customers',
	'debit',
	'destroy',
	'draft_home',
	'edit',
	'export',
	'go_live',
	'go_live_home',
	'hold',
	'index',
	'manage',
	'open',
	'opening',
	'orders',
	'payment',
	'post',
	'publish',
	'restore',
	'revenue',
	'reviews',
	'revoke',
	'send',
	'settle',
	'stock',
	'top_products',
	'update',
	'use',
	'void',
]);
export type PermissionAction = z.infer<typeof PermissionAction>;

/**
 * A granted permission list.
 *
 * Duplicates are not an error worth rejecting a request over, but they are meaningless, so
 * the list is normalized rather than merely validated: a grant of the same code twice is
 * stored once. Sorting makes two equivalent grants byte-identical, which is what lets an
 * audit diff show a real change instead of a reordering.
 */
export const PermissionGrant = z
	.array(PermissionCode)
	.transform((codes) => [...new Set(codes)].sort((a, b) => a.localeCompare(b)));
export type PermissionGrant = z.infer<typeof PermissionGrant>;

/** Splits a code into its parts. Total, because the union guarantees the shape. */
export function parsePermission(code: PermissionCode): { resource: PermissionResource; action: PermissionAction } {
	const separator = code.indexOf('.');
	return {
		resource: code.slice(0, separator) as PermissionResource,
		action: code.slice(separator + 1) as PermissionAction,
	};
}

/** One registry entry, as the grant UI needs to render it. */
export const PermissionDescriptor = z.object({
	code: PermissionCode,
	resource: PermissionResource,
	action: PermissionAction,
	/**
	 * True when no admin navigation entry gates on this code yet.
	 *
	 * Published so a grant screen can show it apart rather than presenting a permission that
	 * unlocks nothing an operator can currently click. Hiding it instead would be worse: the
	 * code IS grantable, and a screen that cannot show what was granted is a screen that
	 * disagrees with the server.
	 */
	serverOnly: z.boolean(),
});
export type PermissionDescriptor = z.infer<typeof PermissionDescriptor>;

export const PermissionListResponse = z.object({ items: z.array(PermissionDescriptor) });
export type PermissionListResponse = z.infer<typeof PermissionListResponse>;

/** The whole registry, described. Order follows `PERMISSION_CODES`, which is stable. */
export function describePermissions(): PermissionDescriptor[] {
	return PERMISSION_CODES.map((code) => ({
		code,
		...parsePermission(code),
		serverOnly: code in SERVER_ONLY_PERMISSION_CODES,
	}));
}

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
 * soft-delete via `customer.destroy` (`status: deleted`) so email/phone can be reclaimed.
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
	'cart.index',
	'category.create',
	'category.destroy',
	'category.edit',
	'category.index',
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
	'customer.update',
	'faq.create',
	'faq.destroy',
	'faq.edit',
	'faq.index',
	'order.create',
	'order.edit',
	'order.index',
	'order.update',
	'page.create',
	'page.destroy',
	'page.edit',
	'page.index',
	'permission.index',
	'point.credit',
	'point.debit',
	'point.index',
	'product.create',
	'product.destroy',
	'product.edit',
	'product.index',
	'question_and_answer.create',
	'question_and_answer.destroy',
	'question_and_answer.edit',
	'question_and_answer.index',
	'refund.action',
	'refund.create',
	'refund.index',
	'review.create',
	'review.destroy',
	'review.index',
	'role.create',
	'role.destroy',
	'role.index',
	'role.update',
	'setting.edit',
	'setting.index',
	'shipping.create',
	'shipping.destroy',
	'shipping.edit',
	'shipping.index',
	'store.create',
	'store.destroy',
	'store.edit',
	'store.index',
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
	'customer.update':
		'Admin Customer CRM profile/address edits and activation resend. Menu gates create/index only; edit screens check this code at the API.',
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
	'role.create': 'Role management surface (auth pass 5c.3); the navigation gates only role.index today.',
	'role.destroy': 'Role management surface (auth pass 5c.3); deleting a role is separate from editing one.',
	'role.update': 'Role management surface (auth pass 5c.3); editing a role changes what everyone holding it can do.',
	'setting.edit':
		'Every write on the settings surfaces: the Save control on the main Settings page, and the two audited notification mutations (PATCH /admin/notifications/channels, PUT /admin/notifications/templates). Reads use setting.index, which is the navigation code; writes deliberately do not.',
	'shipping.create': 'Add-shipping button on the Shipping page. No Shipping navigation entry exists.',
	'shipping.destroy': 'Delete control on a shipping rule row (shipping.html).',
	'shipping.edit': 'Edit control on a shipping rule row (shipping.html).',
	'store.destroy': 'Stores table row Delete action (stores.ts). menu.ts gates store.index and store.create only.',
	'store.edit': 'Stores table row Edit action (stores.ts).',
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
	'admin_user_role',
	'admin_user',
	'attachment',
	'attribute',
	'audit',
	'blog',
	'cart',
	'category',
	'coupon',
	'currency',
	'customer',
	'faq',
	'order',
	'page',
	'permission',
	'point',
	'product',
	'question_and_answer',
	'refund',
	'review',
	'role',
	'setting',
	'shipping',
	'store',
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
 * and `action` covers the payout approve/reject chrome.
 */
export const PermissionAction = z.enum([
	'action',
	'assign',
	'create',
	'credit',
	'debit',
	'destroy',
	'edit',
	'index',
	'revoke',
	'update',
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

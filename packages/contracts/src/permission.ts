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
 * (`*hasPermission`, table actions), server-only administrative surfaces, and the former
 * mock `account.json` permission names needed for AuthStore render parity after mock ACL
 * removal. `scripts/check-permission-registry.mjs` holds menu ↔ registry agreement together.
 *
 * ## What is deliberately absent
 *
 * There is no `admin_user.destroy` for operators: they are deactivated, never deleted, because an
 * audit trail that can lose its subject is not an audit trail. Storefront customers use
 * soft-delete via `customer.destroy` (`status: deleted`) so email/phone can be reclaimed.
 * The registry still grows one route at a time — that is what makes "stable codes" mean
 * anything.
 */
export const PermissionCode = z.enum([
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
	'commission_history.index',
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
	'role.edit',
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
	'theme.edit',
	'theme.index',
	'user_role.assign',
	'user_role.revoke',
	'user.destroy',
	'user.edit',
	'vendor_wallet.credit',
	'vendor_wallet.debit',
	'vendor_wallet.index',
	'wallet.credit',
	'wallet.debit',
	'wallet.index',
	'withdraw_request.action',
	'withdraw_request.create',
	'withdraw_request.index',
]);
export type PermissionCode = z.infer<typeof PermissionCode>;

/** Every code, for building a grant UI or asserting completeness. Ordering is stable. */
export const PERMISSION_CODES: readonly PermissionCode[] = PermissionCode.options;

/**
 * Codes the SERVER needs before any navigation entry gates on them, each with the reason.
 *
 * Also includes create/edit/destroy/credit/debit/action codes that templates and the former
 * mock ACL used for in-page chrome, while `menu.ts` only lists coarse index/create parents.
 */
export const SERVER_ONLY_PERMISSION_CODES: Readonly<Partial<Record<PermissionCode, string>>> = {
	'admin_user.update':
		'Administrative operator editing (auth pass 5c.4), distinct from inviting a new one. Navigation gates create/index only.',
	'attachment.create':
		'Kept admin UI and/or former mock ACL gated on attachment.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (attachment create).',
	'attachment.destroy':
		'Kept admin UI and/or former mock ACL gated on attachment.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (attachment destroy).',
	'attribute.create':
		'Kept admin UI and/or former mock ACL gated on attribute.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (attribute create).',
	'attribute.destroy':
		'Kept admin UI and/or former mock ACL gated on attribute.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (attribute destroy).',
	'attribute.edit':
		'Kept admin UI and/or former mock ACL gated on attribute.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (attribute edit).',
	'audit.index':
		'Reads the audit trail every admin mutation writes (GET /admin/audit-logs). Deliberately its own code rather than folded into admin_user.index or setting.index. No screen gates it yet.',
	'blog.create':
		'Kept admin UI and/or former mock ACL gated on blog.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (blog create).',
	'blog.destroy':
		'Kept admin UI and/or former mock ACL gated on blog.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (blog destroy).',
	'blog.edit':
		'Kept admin UI and/or former mock ACL gated on blog.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (blog edit).',
	'cart.index':
		'Support-read of a customer cart (DEC-ACCOUNT-SEPARATION D4). Coarse staff/admin role must not bypass ownership; this server-only code is the only support path. No navigation entry yet.',
	'category.create':
		'Kept admin UI and/or former mock ACL gated on category.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (category create).',
	'category.destroy':
		'Kept admin UI and/or former mock ACL gated on category.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (category destroy).',
	'category.edit':
		'Kept admin UI and/or former mock ACL gated on category.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (category edit).',
	'commission_history.index':
		'Kept admin UI and/or former mock ACL gated on commission_history.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (commission_history index).',
	'coupon.create':
		'Kept admin UI and/or former mock ACL gated on coupon.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (coupon create).',
	'coupon.destroy':
		'Kept admin UI and/or former mock ACL gated on coupon.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (coupon destroy).',
	'coupon.edit':
		'Kept admin UI and/or former mock ACL gated on coupon.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (coupon edit).',
	'currency.create':
		'Kept admin UI and/or former mock ACL gated on currency.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (currency create).',
	'currency.destroy':
		'Kept admin UI and/or former mock ACL gated on currency.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (currency destroy).',
	'currency.edit':
		'Kept admin UI and/or former mock ACL gated on currency.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (currency edit).',
	'customer.destroy':
		'Admin Customer CRM soft-delete (status deleted). Separate from update so directory editors need not hold irreversible offboarding. Menu gates create/index only.',
	'customer.update':
		'Admin Customer CRM profile/address edits and activation resend. Menu gates create/index only; edit screens check this code at the API.',
	'faq.create':
		'Kept admin UI and/or former mock ACL gated on faq.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (faq create).',
	'faq.destroy':
		'Kept admin UI and/or former mock ACL gated on faq.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (faq destroy).',
	'faq.edit':
		'Kept admin UI and/or former mock ACL gated on faq.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (faq edit).',
	'order.edit':
		'Kept admin UI and/or former mock ACL gated on order.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (order edit).',
	'order.update':
		'Changing an order status (PATCH /orders/:id/status). Navigation gates order.index and order.create only.',
	'page.create':
		'Kept admin UI and/or former mock ACL gated on page.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (page create).',
	'page.destroy':
		'Kept admin UI and/or former mock ACL gated on page.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (page destroy).',
	'page.edit':
		'Kept admin UI and/or former mock ACL gated on page.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (page edit).',
	'permission.index': 'Enumerates this registry so a grant UI can render it; there is no screen of its own to gate.',
	'point.credit':
		'Kept admin UI and/or former mock ACL gated on point.credit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (point credit).',
	'point.debit':
		'Kept admin UI and/or former mock ACL gated on point.debit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (point debit).',
	'product.destroy':
		'Kept admin UI and/or former mock ACL gated on product.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (product destroy).',
	'product.edit':
		'Kept admin UI and/or former mock ACL gated on product.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (product edit).',
	'question_and_answer.create':
		'Kept admin UI and/or former mock ACL gated on question_and_answer.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (question_and_answer create).',
	'question_and_answer.destroy':
		'Kept admin UI and/or former mock ACL gated on question_and_answer.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (question_and_answer destroy).',
	'question_and_answer.edit':
		'Kept admin UI and/or former mock ACL gated on question_and_answer.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (question_and_answer edit).',
	'question_and_answer.index':
		'Kept admin UI and/or former mock ACL gated on question_and_answer.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (question_and_answer index).',
	'refund.action':
		'Kept admin UI and/or former mock ACL gated on refund.action; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (refund action).',
	'refund.create':
		'Kept admin UI and/or former mock ACL gated on refund.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (refund create).',
	'review.create':
		'Kept admin UI and/or former mock ACL gated on review.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (review create).',
	'review.destroy':
		'Kept admin UI and/or former mock ACL gated on review.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (review destroy).',
	'role.create': 'Role management surface (auth pass 5c.3); the navigation gates only role.index today.',
	'role.destroy': 'Role management surface (auth pass 5c.3); deleting a role is separate from editing one.',
	'role.edit':
		'Kept admin UI and/or former mock ACL gated on role.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (role edit).',
	'role.update': 'Role management surface (auth pass 5c.3); editing a role changes what everyone holding it can do.',
	'setting.edit':
		'Kept admin UI and/or former mock ACL gated on setting.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (setting edit).',
	'shipping.create':
		'Kept admin UI and/or former mock ACL gated on shipping.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (shipping create).',
	'shipping.destroy':
		'Kept admin UI and/or former mock ACL gated on shipping.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (shipping destroy).',
	'shipping.edit':
		'Kept admin UI and/or former mock ACL gated on shipping.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (shipping edit).',
	'store.destroy':
		'Kept admin UI and/or former mock ACL gated on store.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (store destroy).',
	'store.edit':
		'Kept admin UI and/or former mock ACL gated on store.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (store edit).',
	'tag.create':
		'Kept admin UI and/or former mock ACL gated on tag.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tag create).',
	'tag.destroy':
		'Kept admin UI and/or former mock ACL gated on tag.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tag destroy).',
	'tag.edit':
		'Kept admin UI and/or former mock ACL gated on tag.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tag edit).',
	'tax.create':
		'Kept admin UI and/or former mock ACL gated on tax.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tax create).',
	'tax.destroy':
		'Kept admin UI and/or former mock ACL gated on tax.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tax destroy).',
	'tax.edit':
		'Kept admin UI and/or former mock ACL gated on tax.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (tax edit).',
	'theme_option.edit':
		'Kept admin UI and/or former mock ACL gated on theme_option.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (theme_option edit).',
	'theme.edit':
		'Kept admin UI and/or former mock ACL gated on theme.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (theme edit).',
	'theme.index':
		'Kept admin UI and/or former mock ACL gated on theme.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (theme index).',
	'user_role.assign': 'Granting authority (auth pass 5c.4). Deliberately not part of admin_user.update.',
	'user_role.revoke':
		'Removing authority (auth pass 5c.4). Separate from assigning it because offboarding must stay possible for operators who may not grant.',
	'user.destroy':
		'Kept admin UI and/or former mock ACL gated on user.destroy; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (user destroy).',
	'user.edit':
		'Kept admin UI and/or former mock ACL gated on user.edit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (user edit).',
	'vendor_wallet.credit':
		'Kept admin UI and/or former mock ACL gated on vendor_wallet.credit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (vendor_wallet credit).',
	'vendor_wallet.debit':
		'Kept admin UI and/or former mock ACL gated on vendor_wallet.debit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (vendor_wallet debit).',
	'vendor_wallet.index':
		'Kept admin UI and/or former mock ACL gated on vendor_wallet.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (vendor_wallet index).',
	'wallet.credit':
		'Kept admin UI and/or former mock ACL gated on wallet.credit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (wallet credit).',
	'wallet.debit':
		'Kept admin UI and/or former mock ACL gated on wallet.debit; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (wallet debit).',
	'wallet.index':
		'Kept admin UI and/or former mock ACL gated on wallet.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (wallet index).',
	'withdraw_request.action':
		'Kept admin UI and/or former mock ACL gated on withdraw_request.action; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (withdraw_request action).',
	'withdraw_request.create':
		'Kept admin UI and/or former mock ACL gated on withdraw_request.create; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (withdraw_request create).',
	'withdraw_request.index':
		'Kept admin UI and/or former mock ACL gated on withdraw_request.index; not a menu.ts navigation acl_permission. Held in the registry so AuthStore/effective grants can restore render parity after mock ACL removal (withdraw_request index).',
};

/** The resource half of a code — the noun a permission is about. */
export const PermissionResource = z.enum([
	'admin_user',
	'attachment',
	'attribute',
	'audit',
	'blog',
	'cart',
	'category',
	'commission_history',
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
	'theme',
	'theme_option',
	'user',
	'user_role',
	'vendor_wallet',
	'wallet',
	'withdraw_request',
]);
export type PermissionResource = z.infer<typeof PermissionResource>;

/**
 * The action half. Extending this is a registry decision, not an implementation detail.
 *
 * `assign` and `revoke` are separate actions rather than one `manage`, because granting
 * authority and removing it carry opposite risks. `edit` remains alongside `update` where the
 * kept admin UI / former mock ACL still gate on Fastkart-era `.edit` strings. `credit` /
 * `debit` / `action` cover points, wallet, and withdraw chrome.
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

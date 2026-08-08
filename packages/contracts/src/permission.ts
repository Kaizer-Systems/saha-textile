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
 * ## Why exactly these codes
 *
 * They are not invented. These are the codes the admin application's navigation already gates
 * on (`apps/admin/src/app/shared/data/menu.ts`), reconciled one-for-one:
 * **26 codes across 22 resources**. `scripts/check-permission-registry.mjs` asserts the two
 * lists stay identical in both directions, so a menu entry cannot start gating on a
 * permission the server has never heard of, and a code cannot be retired here while the
 * navigation still asks for it.
 *
 * ## What is deliberately absent
 *
 * Only `index` and `create` actions exist, because only those are in use. There is no
 * `product.update` or `product.destroy` yet — the routes that would need them are not built,
 * and inventing 22 resources × 4 actions of speculative codes would produce a registry whose
 * majority is untested fiction. Adding an action is a deliberate one-line edit here plus the
 * route that consumes it, which is what "stable codes" is meant to cost.
 *
 * ## What this does NOT do
 *
 * No route requires a permission yet (auth pass 5a, owner-chosen scope). `SessionGuard` holds
 * that grants are authoritative and a role implies nothing, so enforcing before grants can be
 * administered would 403 every existing administrator out of the back office — there is no
 * first-admin bootstrap (6a) and no grant surface (5c) to recover through. Enforcement lands
 * in 5c alongside its escalation tests.
 */
export const PermissionCode = z.enum([
	'attachment.index',
	'attribute.index',
	'blog.index',
	'category.index',
	'coupon.index',
	'currency.index',
	'faq.index',
	'order.create',
	'order.index',
	'page.index',
	'point.index',
	'product.create',
	'product.index',
	'refund.index',
	'review.index',
	'role.index',
	'setting.index',
	'shipping.index',
	'store.create',
	'store.index',
	'tag.index',
	'tax.index',
	'theme_option.index',
	'user.create',
	'user.index',
	'wallet.index',
]);
export type PermissionCode = z.infer<typeof PermissionCode>;

/** Every code, for building a grant UI or asserting completeness. Ordering is stable. */
export const PERMISSION_CODES: readonly PermissionCode[] = PermissionCode.options;

/** The resource half of a code — the noun a permission is about. */
export const PermissionResource = z.enum([
	'attachment',
	'attribute',
	'blog',
	'category',
	'coupon',
	'currency',
	'faq',
	'order',
	'page',
	'point',
	'product',
	'refund',
	'review',
	'role',
	'setting',
	'shipping',
	'store',
	'tag',
	'tax',
	'theme_option',
	'user',
	'wallet',
]);
export type PermissionResource = z.infer<typeof PermissionResource>;

/** The action half. Extending this is a registry decision, not an implementation detail. */
export const PermissionAction = z.enum(['index', 'create']);
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
	const [resource, action] = code.split('.');
	return { resource: resource as PermissionResource, action: action as PermissionAction };
}

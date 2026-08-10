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
 * **26** were reconciled from the admin application's navigation, which already gated on a
 * vocabulary the API had never heard of (`apps/admin/src/app/shared/data/menu.ts`). **7** more
 * were added for the administrative surfaces themselves — role editing and role assignment —
 * and those have no navigation entry yet, so they are declared server-only below.
 * `scripts/check-permission-registry.mjs` holds the whole arrangement together.
 *
 * ## What is deliberately absent
 *
 * There is no `user.destroy`: accounts are deactivated, never deleted, because an audit trail
 * that can lose its subject is not an audit trail. And there is no code for a resource whose
 * administrative surface is not being built — the registry grows one route at a time, which is
 * what makes "stable codes" mean anything.
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
	'permission.index',
	'point.index',
	'product.create',
	'product.index',
	'refund.index',
	'review.index',
	'role.create',
	'role.destroy',
	'role.index',
	'role.update',
	'setting.index',
	'shipping.index',
	'store.create',
	'store.index',
	'tag.index',
	'tax.index',
	'theme_option.index',
	'user_role.assign',
	'user_role.revoke',
	'user.create',
	'user.index',
	'user.update',
	'wallet.index',
]);
export type PermissionCode = z.infer<typeof PermissionCode>;

/** Every code, for building a grant UI or asserting completeness. Ordering is stable. */
export const PERMISSION_CODES: readonly PermissionCode[] = PermissionCode.options;

/**
 * Codes the SERVER needs before any navigation entry gates on them, each with the reason.
 *
 * The registry and the admin navigation are otherwise held identical in both directions,
 * because a code neither side uses is either a retired feature or a screen nobody gated. That
 * rule is right, and it would also block every API surface built before its UI — which is the
 * normal order of work here. This map is the escape hatch, and it is deliberately a map
 * rather than a list: an entry has to carry a justification, so "why can nothing reach this?"
 * is answered in the file rather than in somebody's memory.
 *
 * An entry is a promise to build the screen. It is not a parking space for codes nobody
 * intends to use — `check-permission-registry.mjs` still requires every code to be declared
 * here or reachable from the menu, so an abandoned entry stays visible in review forever.
 */
export const SERVER_ONLY_PERMISSION_CODES: Readonly<Partial<Record<PermissionCode, string>>> = {
	'permission.index': 'Enumerates this registry so a grant UI can render it; there is no screen of its own to gate.',
	'role.create': 'Role management surface (auth pass 5c.3); the navigation gates only role.index today.',
	'role.destroy': 'Role management surface (auth pass 5c.3); deleting a role is separate from editing one.',
	'role.update': 'Role management surface (auth pass 5c.3); editing a role changes what everyone holding it can do.',
	'user.update': 'Administrative user editing (auth pass 5c.4), distinct from inviting a new one.',
	'user_role.assign':
		'Granting authority (auth pass 5c.4). Deliberately not part of user.update: changing a display name and changing what somebody may do are not the same risk.',
	'user_role.revoke':
		'Removing authority (auth pass 5c.4). Separate from assigning it because offboarding must stay possible for operators who may not grant.',
};

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
	'permission',
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
	'user_role',
	'wallet',
]);
export type PermissionResource = z.infer<typeof PermissionResource>;

/**
 * The action half. Extending this is a registry decision, not an implementation detail.
 *
 * `assign` and `revoke` are separate actions rather than one `manage`, because granting
 * authority and removing it carry opposite risks: the dangerous direction is upward, and
 * `no-delegation-above-self` constrains only granting. An operator who may offboard someone
 * need not be an operator who may promote them.
 */
export const PermissionAction = z.enum(['assign', 'create', 'destroy', 'index', 'revoke', 'update']);
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

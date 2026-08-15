import { describe, expect, it } from 'vitest';

import { AdminNotificationsController } from '../src/admin/admin-notifications.controller';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';

/**
 * Read/write separation on the notification settings surface.
 *
 * Every route on this controller once declared `setting.index` — a READ code — including the
 * two mutations, both of which write audited configuration: the channel × category
 * kill-switches, and the MSG91 Flow / WhatsApp template ids messages are actually sent
 * through. A grant intended to let someone LOOK at notification settings therefore also let
 * them silence a transactional channel or repoint a template.
 *
 * The registry has always carried `setting.edit` for exactly this, and the main Settings page
 * already gated its Save control on it. Only this controller disagreed.
 *
 * Asserted at the decorator rather than through a live request because the refusal itself is
 * already proven: `session.guard.test.ts` covers "required permission not held → Forbidden"
 * against the same metadata key. What was never pinned down is WHICH code each route asks
 * for, and that is the part that silently regressed.
 */
describe('admin notification routes — declared permissions', () => {
	const requiredFor = (method: keyof AdminNotificationsController): string[] | undefined =>
		Reflect.getMetadata(PERMISSIONS_KEY, AdminNotificationsController.prototype[method]);

	describe('reads ask for setting.index', () => {
		it.each(['provider', 'listChannels', 'usage', 'listTemplates'] as const)('%s', (method) => {
			expect(requiredFor(method)).toEqual(['setting.index']);
		});
	});

	describe('writes ask for setting.edit', () => {
		it.each(['toggle', 'upsertTemplate'] as const)('%s', (method) => {
			expect(requiredFor(method)).toEqual(['setting.edit']);
		});
	});

	/**
	 * The property that matters, stated directly rather than inferred from the two blocks
	 * above: holding only the read code satisfies no mutation on this controller.
	 */
	it('leaves every mutation unreachable to a setting.index-only operator', () => {
		const readOnlyGrant = ['setting.index'];
		for (const method of ['toggle', 'upsertTemplate'] as const) {
			const required = requiredFor(method) ?? [];
			expect(required.length).toBeGreaterThan(0);
			expect(required.every((code) => readOnlyGrant.includes(code))).toBe(false);
		}
	});
});

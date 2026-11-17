import { type APIRequestContext, expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { API_URL } from './support';

/**
 * Who may change each page (Page Builder SG-19) through the real API and session. For the length of this file the
 * e2e admin holds one role instead of Administrator: first with Home's own draft and Go Live codes only, then with
 * neither. Everything is put back after, whatever happens.
 */
const ROLE = 'role_e2e_home_only';
const LAYOUT = 'lay_e2e_access';
const REVISION = 'rev_e2e_access';
const HOME_ONLY = ['theme_option.index', 'page_builder.draft_home', 'page_builder.go_live_home'];

let adminId = '';
let administratorAssignments: string[] = [];

const newsletter = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all',
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
	id: 'news',
	type: 'newsletter',
	title: { en: 'Join', bn: 'যোগ দিন' },
	subtitle: {},
};

const setRole = (permissions: string[]) =>
	withDatabase((db) =>
		db.collection('roles').updateOne({ _id: ROLE as never }, { $set: { permissions, updatedAt: new Date() } }),
	);

async function csrf(request: APIRequestContext): Promise<string> {
	const answer = await request.get(`${API_URL}/auth/admin/csrf`);
	return ((await answer.json()) as { csrfToken: string }).csrfToken;
}

test.describe.serial('who may change each page (SG-19)', () => {
	test.beforeAll(async () => {
		const now = new Date();
		await withDatabase(async (db) => {
			const email = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@example.test';
			const admin = await db.collection('adminUsers').findOne({ email });
			if (!admin) throw new Error('No e2e admin');
			adminId = String(admin._id);
			const active = await db
				.collection('adminUserRoleAssignments')
				.find({ userId: adminId, revokedAt: null })
				.toArray();
			administratorAssignments = active.map((row) => String(row._id));
			await db.collection('roles').replaceOne(
				{ _id: ROLE as never },
				{
					key: 'e2e_home_only',
					label: 'e2e Home only',
					description: 'Page Builder SG-19 e2e',
					baseRole: 'admin',
					isSystem: false,
					permissions: HOME_ONLY,
					createdAt: now,
					updatedAt: now,
				},
				{ upsert: true },
			);
			await db
				.collection('adminUserRoleAssignments')
				.updateMany({ _id: { $in: administratorAssignments as never[] } }, { $set: { revokedAt: now } });
			await db.collection('adminUserRoleAssignments').insertOne({
				_id: 'ura_e2e_home_only' as never,
				userId: adminId,
				roleId: ROLE,
				assignedByUserId: null,
				assignedAt: now,
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			});
			await db.collection('pageLayouts').updateOne(
				{ _id: LAYOUT as never },
				{
					$set: {
						pageType: 'home',
						target: 'page',
						name: 'e2e access',
						template: null,
						draftRevisionId: REVISION,
						lastLiveRevisionId: null,
						revisionCount: 1,
						reviewRequest: null,
						createdAt: now,
						updatedAt: now,
						updatedBy: null,
					},
				},
				{ upsert: true },
			);
			await db.collection('pageLayoutRevisions').updateOne(
				{ _id: REVISION as never },
				{
					$set: {
						layoutId: LAYOUT,
						number: 1,
						sections: [newsletter],
						assetIds: [],
						createdAt: now,
						createdBy: null,
						wentLiveAt: null,
					},
				},
				{ upsert: true },
			);
		});
	});

	test.afterAll(async () => {
		await withDatabase(async (db) => {
			await db.collection('adminUserRoleAssignments').deleteOne({ _id: 'ura_e2e_home_only' as never });
			await db
				.collection('adminUserRoleAssignments')
				.updateMany({ _id: { $in: administratorAssignments as never[] } }, { $set: { revokedAt: null } });
			await db.collection('roles').deleteOne({ _id: ROLE as never });
			await db.collection('pageLayoutRevisions').deleteMany({ layoutId: LAYOUT });
			await db.collection('pageLayouts').deleteOne({ _id: LAYOUT as never });
			await db.collection('pageLocks').deleteMany({ layoutId: LAYOUT });
		});
	});

	test("Home's own codes: builds Home's drafts and may go live there", async ({ page }) => {
		const request = page.request;
		const token = await csrf(request);
		const view = await request.get(`${API_URL}/admin/page-builder/layouts/${LAYOUT}/go-live`);
		expect(view.status()).toBe(200);
		expect(((await view.json()) as { canGoLive: boolean }).canGoLive).toBe(true);
		const saved = await request.put(`${API_URL}/admin/page-builder/layouts/${LAYOUT}/draft`, {
			headers: { 'x-csrf-token': token },
			data: { sections: [newsletter], expectedDraftId: REVISION },
		});
		expect(saved.status()).toBe(200);
		// A switch that isn't on the schedule: allowed through the door, then not found.
		const cancel = await request.post(`${API_URL}/admin/page-builder/pages/home/cancel-switch`, {
			headers: { 'x-csrf-token': token },
			data: { revisionId: 'rev_none', from: new Date().toISOString() },
		});
		expect(cancel.status()).not.toBe(403);
	});

	test('without them: the draft and the schedule are refused, and the checks say so', async ({ page }) => {
		const request = page.request;
		await setRole(['theme_option.index']);
		const token = await csrf(request);
		const view = await request.get(`${API_URL}/admin/page-builder/layouts/${LAYOUT}/go-live`);
		expect(((await view.json()) as { canGoLive: boolean }).canGoLive).toBe(false);
		const saved = await request.put(`${API_URL}/admin/page-builder/layouts/${LAYOUT}/draft`, {
			headers: { 'x-csrf-token': token },
			data: { sections: [newsletter], expectedDraftId: REVISION },
		});
		expect(saved.status()).toBe(403);
		const putBack = await request.post(`${API_URL}/admin/page-builder/pages/home/put-back`, {
			headers: { 'x-csrf-token': token },
			data: {},
		});
		expect(putBack.status()).toBe(403);
		const created = await request.post(`${API_URL}/admin/page-builder/pages/home/layouts`, {
			headers: { 'x-csrf-token': token },
			data: { name: 'Refused', start: 'blank', copyOf: null, template: null, bringPictures: false },
		});
		expect(created.status()).toBe(403);
	});
});

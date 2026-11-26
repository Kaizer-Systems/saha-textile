import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { type APIRequestContext, expect, request as requests, test } from '@playwright/test';

import { withDatabase } from './database';
import { API_URL } from './support';

/**
 * Who may change each page (Page Builder SG-19) through the real API and session. The file signs in an admin of its
 * own, made for it and removed after, who holds one role: first with Home's own draft and Go Live codes only, then
 * with neither. The shared e2e admin keeps Administrator throughout, so admin specs running beside this one are never
 * refused.
 */
const ROLE = 'role_e2e_home_only';
const LAYOUT = 'lay_e2e_access';
const REVISION = 'rev_e2e_access';
const HOME_ONLY = ['theme_option.index', 'page_builder.draft_home', 'page_builder.go_live_home'];
const USER = 'adm_e2e_home_only';
const EMAIL = 'e2e-home-only@example.test';
const ASSIGNMENT = 'ura_e2e_home_only';
const CREDENTIAL = `pcred_admin_user_${USER}`;

/** The API's own password hashing (argon2id, its default settings), from the API's dependencies. */
const argon2 = createRequire(resolve(__dirname, '../apps/api/package.json'))('argon2') as {
	argon2id: number;
	hash(plain: string, options: { type: number }): Promise<string>;
};

/** This file's admin, signed in on a request context of its own. */
let session: APIRequestContext;

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
		// Made here, used once, never shown: the password only signs this file's admin in below.
		const password = randomBytes(24).toString('base64url');
		const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
		await withDatabase(async (db) => {
			await db.collection('adminUsers').replaceOne(
				{ _id: USER as never },
				{
					email: EMAIL,
					emailVerified: true,
					username: null,
					displayName: 'e2e Home only',
					phone: null,
					role: 'admin',
					status: 'active',
					preferredLoginMethod: 'password',
					permissions: [],
					tokenVersion: 0,
					permissionsVersion: 0,
					failedLoginAttempts: 0,
					lastLoginAt: null,
					createdAt: now,
					updatedAt: now,
				},
				{ upsert: true },
			);
			await db
				.collection('passwordCredentials')
				.replaceOne(
					{ _id: CREDENTIAL as never },
					{ subjectType: 'admin_user', subjectId: USER, passwordHash, createdAt: now, updatedAt: now },
					{ upsert: true },
				);
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
			await db.collection('adminUserRoleAssignments').replaceOne(
				{ _id: ASSIGNMENT as never },
				{
					userId: USER,
					roleId: ROLE,
					assignedByUserId: null,
					assignedAt: now,
					revokedAt: null,
					revokedByUserId: null,
					revokeReason: null,
				},
				{ upsert: true },
			);
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
		// An empty start: the admin project's saved sign-in would otherwise come along with the shared admin's cookies.
		session = await requests.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
		const signedIn = await session.post(`${API_URL}/auth/admin/login`, { data: { identifier: EMAIL, password } });
		if (!signedIn.ok()) throw new Error(`This file's admin could not sign in (${signedIn.status()})`);
	});

	test.afterAll(async () => {
		await session?.dispose();
		await withDatabase(async (db) => {
			await db.collection('authSessions').deleteMany({ userId: USER });
			await db.collection('adminUserRoleAssignments').deleteOne({ _id: ASSIGNMENT as never });
			await db.collection('passwordCredentials').deleteOne({ _id: CREDENTIAL as never });
			await db.collection('adminUsers').deleteOne({ _id: USER as never });
			await db.collection('roles').deleteOne({ _id: ROLE as never });
			await db.collection('pageLayoutRevisions').deleteMany({ layoutId: LAYOUT });
			await db.collection('pageLayouts').deleteOne({ _id: LAYOUT as never });
			await db.collection('pageLocks').deleteMany({ layoutId: LAYOUT });
		});
	});

	test("Home's own codes: builds Home's drafts and may go live there", async () => {
		const request = session;
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

	test('without them: the draft and the schedule are refused, and the checks say so', async () => {
		const request = session;
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

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { DocumentLockAsksController, EditLogService } from '../src/ledger/edit-log';

/** A document's edit log with its people, and "Ask them to release it" (accounts brief Q11, B5, B7). */

const at = '2026-11-25T05:11:00.000Z';

function setup() {
	const appended: { action: string; entityType: string; entityId: string; retentionTier: string }[] = [];
	const users: Record<string, Record<string, string | null>> = {
		adm_a: { displayName: 'Meera Sharma', email: 'meera@x.test', username: 'meera' },
		adm_b: { displayName: '', email: 'sudip@x.test', username: 'sudip' },
		adm_c: { displayName: '', email: '', username: 'gopa' },
		adm_d: { displayName: '', email: '', username: '' },
	};
	const service = new EditLogService(
		{
			list: async () => ({
				items: [
					{
						createdAt: '2026-11-25T05:12:00.000Z',
						actorUserId: null,
						action: 'creditNote.posted',
						diffs: [],
						metadata: { a: 1 },
					},
					{ createdAt: at, actorUserId: 'adm_a', action: 'creditNote.draft', diffs: [], metadata: {} },
					{
						createdAt: '2026-11-25T05:13:00.000Z',
						actorUserId: 'adm_a',
						action: 'creditNote.save',
						diffs: [{ field: 'reason' }],
						metadata: {},
					},
					{
						createdAt: '2026-11-25T05:15:00.000Z',
						actorUserId: 'adm_c',
						action: 'creditNote.issue',
						diffs: [],
						metadata: {},
					},
					{
						createdAt: '2026-11-25T05:14:00.000Z',
						actorUserId: 'adm_b',
						action: 'creditNote.print',
						diffs: [],
						metadata: {},
					},
				],
				total: 5,
				page: 1,
				pageSize: 200,
			}),
			append: async (row: (typeof appended)[number]) => void appended.push(row),
		} as never,
		{ findById: async (id: string) => users[id] ?? null } as never,
		{
			listActiveForUser: async (id: string) =>
				id === 'adm_a' ? [{ roleId: 'role_mgr' }] : id === 'adm_b' ? [{ roleId: 'role_gone' }] : [],
		} as never,
		{ findById: async (id: string) => (id === 'role_mgr' ? { label: 'Location manager' } : null) } as never,
	);
	return { service, appended };
}

describe('the edit log', () => {
	it('lists rows oldest first with each person’s name and role, and the system’s rows with none', async () => {
		const { service } = setup();
		const rows = await service.entries('creditNote', 'cn_1');
		expect(rows.map((r) => [r.action, r.who, r.role])).toEqual([
			['creditNote.draft', 'Meera Sharma', 'Location manager'],
			['creditNote.posted', null, null],
			['creditNote.save', 'Meera Sharma', 'Location manager'],
			['creditNote.print', 'sudip@x.test', null],
			['creditNote.issue', 'gopa', null],
		]);
		expect(rows[2]?.diffs).toEqual([{ field: 'reason' }]);
	});

	it('names people by display name, else e-mail, else username, else their id', async () => {
		const { service } = setup();
		expect(await service.nameOf('adm_c')).toBe('gopa');
		expect(await service.nameOf('adm_d')).toBe('adm_d');
		expect(await service.nameOf('adm_x')).toBe('adm_x');
	});

	it('appends a row kept with the books', async () => {
		const { service, appended } = setup();
		await service.append('adm_a', 'creditNote.print', 'creditNote', 'cn_1', []);
		expect(appended[0]).toMatchObject({ action: 'creditNote.print', retentionTier: 'books' });
	});
});

describe('who holds a document, and asking them to release it (B7)', () => {
	const lock = {
		documentType: 'creditNote',
		documentId: 'cn_1',
		holderId: 'adm_a',
		holderName: 'Meera Sharma',
		since: at,
		lastActiveAt: at,
		releaseAskedBy: null as string | null,
		releaseAskedAt: null as string | null,
	};

	function routes(current: typeof lock | null, asked = true) {
		const { service, appended } = setup();
		const controller = new DocumentLockAsksController(
			{ get: async () => current, askRelease: async () => asked } as never,
			service,
		);
		return { controller, appended };
	}

	it('says nobody holds it, or who does, showing a release asked only after they took it', async () => {
		expect(await routes(null).controller.current('creditNote', 'cn_1')).toEqual({ lock: null, role: null });
		expect((await routes(lock).controller.current('creditNote', 'cn_1')).role).toBe('Location manager');
		expect((await routes(lock).controller.current('creditNote', 'cn_1')).lock?.releaseAskedBy).toBeNull();
		const askedLater = { ...lock, releaseAskedBy: 'Owner', releaseAskedAt: '2026-11-25T05:20:00.000Z' };
		expect((await routes(askedLater).controller.current('creditNote', 'cn_1')).lock?.releaseAskedBy).toBe('Owner');
		const askedBefore = { ...lock, releaseAskedBy: 'Owner', releaseAskedAt: '2026-11-25T05:00:00.000Z' };
		expect((await routes(askedBefore).controller.current('creditNote', 'cn_1')).lock).toMatchObject({
			releaseAskedBy: null,
			releaseAskedAt: null,
		});
	});

	it('asks the holder by name and logs it, and refuses someone not signed in', async () => {
		const held = routes(lock);
		const target = { documentType: 'creditNote', documentId: 'cn_1' };
		expect(await held.controller.askRelease(target, { userId: 'adm_b' } as never)).toEqual({ asked: true });
		expect(held.appended[0]).toMatchObject({ action: 'document.lock.ask_release', entityId: 'cn_1' });
		const free = routes(null, false);
		expect(await free.controller.askRelease(target, { userId: 'adm_b' } as never)).toEqual({ asked: false });
		expect(free.appended).toEqual([]);
		await expect(held.controller.askRelease(target)).rejects.toBeInstanceOf(ForbiddenException);
	});
});

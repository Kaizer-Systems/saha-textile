import type { EmailPicture } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { EmailPicturesService } from '../src/media/email-pictures.service';

/** Clean up › Email pictures (media step 3f; Media brief R6-1, A50, A51). */
const picture = (key: string, goneBy: string | null = 'adm_1'): EmailPicture => ({
	key,
	assetId: 'med_gone',
	photoName: 'Red Banarasi.jpg',
	width: 300,
	bytes: 20_000,
	why: 'deleted',
	goneAt: '2026-11-16T10:00:00.000Z',
	goneBy,
	sentCount: 0,
	lastSentAt: null,
});

const setup = (rows: EmailPicture[]) => {
	const store = new Map(rows.map((row) => [row.key, row]));
	const pictures = {
		keep: vi.fn(),
		list: vi.fn(async () => [...store.values()]),
		count: vi.fn(async () => store.size),
		totals: vi.fn(async () => ({ count: store.size, bytes: store.size * 20_000 })),
		findByKeys: vi.fn(async (keys: readonly string[]) =>
			keys.flatMap((key) => (store.has(key) ? [store.get(key)] : [])),
		),
		remove: vi.fn(async (keys: readonly string[]) => keys.forEach((key) => store.delete(key))),
	};
	const jobs: unknown[] = [];
	const audit = { append: vi.fn(async (entry: unknown) => entry) };
	const service = new EmailPicturesService(
		pictures as never,
		{ getUrl: (key: string) => `https://cdn.test/${key}` },
		{ enqueue: async (job: unknown) => void jobs.push(job) } as never,
		audit as never,
		{ findById: async (id: string) => (id === 'adm_1' ? { displayName: 'Moulik' } : null) } as never,
	);
	return { service, pictures, jobs, audit, store };
};

describe('EmailPicturesService', () => {
	it('lists the kept pictures with their address and who deleted the photo, and the totals', async () => {
		const { service } = setup([
			picture('email/med_gone/a-300w-1.jpg'),
			picture('email/med_gone/a-150w-2.jpg', null),
		]);
		const list = await service.list({ sent: 'all' });
		expect(list.rows[0]).toMatchObject({
			key: 'email/med_gone/a-300w-1.jpg',
			url: 'https://cdn.test/email/med_gone/a-300w-1.jpg',
			goneByName: 'Moulik',
		});
		expect(list.rows[1]?.goneByName).toBeNull();
		expect(list).toMatchObject({ total: { count: 2, bytes: 40_000 }, matching: 2, next: null });
	});

	it('deletes only recorded pictures, for good, and says who in Activity', async () => {
		const { service, jobs, audit, store } = setup([picture('email/med_gone/a-300w-1.jpg')]);
		const done = await service.remove('adm_1', ['email/med_gone/a-300w-1.jpg', 'email/med_live/b-300w-9.jpg']);
		expect(done).toEqual({ deleted: 1, bytes: 20_000 });
		expect(jobs).toEqual([
			{
				type: 'delete-objects',
				keys: ['email/med_gone/a-300w-1.jpg'],
				urls: ['https://cdn.test/email/med_gone/a-300w-1.jpg'],
			},
		]);
		expect(store.size).toBe(0);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'media.email_pictures.delete', actorUserId: 'adm_1' }),
		);
		expect(await service.remove('adm_1', ['email/med_live/b-300w-9.jpg'])).toEqual({ deleted: 0, bytes: 0 });
	});
});

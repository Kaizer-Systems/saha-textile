import { describe, expect, it, vi } from 'vitest';

import { EDocsService } from '../src/edocs/edocs.service';

/** The e-way bill list's validity filter is judged against the time it is asked, so "ends soon" is never stale. */

function service() {
	const repo = { list: vi.fn(async () => ({ rows: [], total: 0 })) };
	const unused = {} as never;
	return { edocs: new EDocsService(repo as never, unused, unused, unused, unused), repo };
}

describe('the e-document list by validity', () => {
	it('asks the store with the time now when filtering by validity', async () => {
		const { edocs, repo } = service();
		const now = new Date('2026-11-25T18:30:00.000Z');
		await edocs.list({ kind: 'eWayBill', validity: 'endsSoon', page: 1, pageSize: 50 }, now);
		expect(repo.list).toHaveBeenCalledWith({
			kind: 'eWayBill',
			validity: 'endsSoon',
			at: '2026-11-25T18:30:00.000Z',
			page: 1,
			pageSize: 50,
		});
	});

	it('takes the clock’s time when none is given, and passes a filter without validity as it is', async () => {
		const { edocs, repo } = service();
		const before = Date.now();
		await edocs.list({ kind: 'eWayBill', validity: 'ended', page: 1, pageSize: 50 });
		const at = (repo.list.mock.calls[0] as unknown as [{ at: string }])[0].at;
		expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
		const plain = { kind: 'eInvoice' as const, status: 'active' as const, page: 2, pageSize: 20 };
		await edocs.list(plain);
		expect(repo.list).toHaveBeenLastCalledWith(plain);
	});
});

import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductBulkPopup } from './product-bulk-popup';

import type { ProductBulkResult } from '@saha-textile/contracts';

const row = (
	id: string,
	outcome: 'done' | 'skipped' | 'refused',
	reason: string | null = null,
	gaps: unknown[] = [],
) => ({
	id,
	title: `Saree ${id}`,
	outcome,
	reason,
	gaps,
	copyId: null,
	copySku: null,
});
const plan = (...rows: ReturnType<typeof row>[]) => ({ dryRun: true, rows }) as ProductBulkResult;

const make = () => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(ProductBulkPopup, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(ProductBulkPopup).componentInstance;
	return { popup, modal };
};

afterEach(() => vi.restoreAllMocks());

describe('ProductBulkPopup', () => {
	it('counts what will be done, skipped and refused, and names the refused', () => {
		const { popup } = make();
		popup.start({
			action: 'go-live',
			plan: plan(
				row('a', 'done'),
				row('b', 'done'),
				row('c', 'skipped', 'already_live'),
				row('d', 'refused', 'needs_work', [{ field: 'name', locale: 'bn' }]),
				row('e', 'refused', null),
			),
			act: vi.fn(),
		});
		expect(popup.word('bulk_title_')).toBe('bulk_title_go_live');
		expect(popup.doneCount()).toBe(2);
		expect(popup.pills()).toEqual([
			{ key: 'bulk_done_go_live', count: 2, pill: 'status-success' },
			{ key: 'bulk_reason_already_live', count: 1, pill: 'status-awaiting_for_approval' },
			{ key: 'bulk_reason_needs_work', count: 1, pill: 'status-pending' },
			{ key: 'bulk_reason_failed', count: 1, pill: 'status-pending' },
		]);
		expect(popup.refused()).toEqual([
			{ title: 'Saree d', why: 'বাংলা: gap_name' },
			{ title: 'Saree e', why: 'bulk_why_failed' },
		]);
	});

	it('acts and closes with the answer; a failure keeps it open', async () => {
		const { popup, modal } = make();
		const answer = plan(row('a', 'done'));
		const act = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('no'));
		popup.start({ action: 'take-off', plan: plan(row('a', 'done')), act });
		await popup.confirm();
		expect(act).toHaveBeenCalledWith(null);
		expect(modal.close).toHaveBeenCalledWith(answer);
		await popup.confirm();
		expect(popup.failed()).toBe(true);
	});

	it('waits for nothing to do, and for a page when Discontinue sends old links to one', async () => {
		const { popup } = make();
		expect(popup.canConfirm()).toBe(false);
		await popup.confirm();
		popup.start({ action: 'discontinue', plan: plan(row('a', 'skipped', 'discontinued')), act: vi.fn() });
		expect(popup.canConfirm()).toBe(false);
		const act = vi.fn().mockResolvedValue(plan());
		popup.start({ action: 'discontinue', plan: plan(row('a', 'done')), act });
		popup.linkChoice.set('page');
		expect(popup.canConfirm()).toBe(false);
		popup.pickReplacement({ value: '/collections/sarees' } as never);
		expect(popup.canConfirm()).toBe(true);
		await popup.confirm();
		expect(act).toHaveBeenCalledWith('/collections/sarees');
		popup.pickReplacement({ value: '' } as never);
		expect(popup.replacement()).toBeNull();
	});
});

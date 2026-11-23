import { signal } from '@angular/core';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Events } from './event/events';
import { FormEvent } from './event/form-event/form-event';
import { Media } from './media/media';
import { BundleList } from './product/bundles/bundle-list';
import { PriceMethodBuilder } from './product/bundles/price-method-builder';

/**
 * Screens with no test harness yet, checked method by method: what each table action, picker and list request
 * hands on. Each method runs on a stand-in holding only what it reads.
 */
describe('a screen hands each action’s data to the right step', () => {
	it('events: Edit and Delete go to the row’s own steps', () => {
		const screen = { edit: vi.fn(), delete: vi.fn() };
		const row = { id: 'evt_1' };
		Events.prototype.onActionClicked.call(screen, { actionToPerform: 'edit', data: row });
		Events.prototype.onActionClicked.call(screen, { actionToPerform: 'delete', data: row });
		expect(screen.edit).toHaveBeenCalledWith(row);
		expect(screen.delete).toHaveBeenCalledWith(row);
	});

	it('event form: the popup keeps up to five pictures from a list, one picture, or none', () => {
		const screen = { popupImages: signal<unknown[]>([]), popupImageIds: '', form: { markAsDirty: vi.fn() } };
		const select = (value: unknown) => FormEvent.prototype.selectPopupImages.call(screen, value as never);
		select([1, 2, 3, 4, 5, 6].map((id) => ({ id })));
		expect(screen.popupImageIds).toBe('1,2,3,4,5');
		select({ id: 'med_9' });
		expect(screen.popupImageIds).toBe('med_9');
		select(null);
		expect(screen.popupImages()).toEqual([]);
		expect(screen.form.markAsDirty).toHaveBeenCalledTimes(3);
	});

	it('media library: the box hands back a list, and one picture becomes a list of one', () => {
		const screen = { images: [] as unknown[] };
		Media.prototype.selectImage.call(screen, [{ id: 1 }] as never);
		expect(screen.images).toEqual([{ id: 1 }]);
		Media.prototype.selectImage.call(screen, { id: 2 } as never);
		expect(screen.images).toEqual([{ id: 2 }]);
	});

	it('bundle list: asks for the search, page and page size, 30 to a page unless chosen', () => {
		const params = signal<Record<string, unknown>>({ search: 'silk', page: '2', paginate: '50' });
		const screen = { params };
		expect(BundleList.prototype.listRequest.call(screen)).toEqual({ search: 'silk', page: 2, pageSize: 50 });
		params.set({});
		expect(BundleList.prototype.listRequest.call(screen)).toEqual({ search: undefined, page: 1, pageSize: 30 });
	});

	it('price method: an opened method keeps only what can be saved', async () => {
		const row = { id: 'pm_1', seeded: true, version: 3, usedBy: 2, createdAt: 'a', updatedAt: 'b', name: 'Tiered' };
		const screen = { id: 'pm_1', bundles: { method: vi.fn(() => of(row)) }, method: { set: vi.fn() } };
		await (PriceMethodBuilder.prototype as unknown as { load(this: unknown): Promise<void> }).load.call(screen);
		expect(screen.bundles.method).toHaveBeenCalledWith('pm_1');
		expect(screen.method.set).toHaveBeenCalledWith({ name: 'Tiered' });
	});
});

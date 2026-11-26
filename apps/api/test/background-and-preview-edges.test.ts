import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundleStockService } from '../src/catalog/bundles/bundle-stock.service';
import { UNDO_SEND_SWEEP_MS, UndoSendDispatcher } from '../src/mailboxes/undo-send.dispatcher';
import { PagePreviewService } from '../src/page-builder/page-preview.service';
import { SHOP_PAYMENT_SWEEP_MS, ShopPaymentSweep } from '../src/shop-checkout/shop-payment-sweep';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('bundle stock kept current', () => {
	const stock = { setsPossible: 2, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] };
	const setup = (listContaining: (id: string) => Promise<Array<{ productId: string }>>) => {
		const bundles = {
			listContaining: vi.fn(listContaining),
			findByProductId: vi.fn(async (id: string) => (id === 'prd_gone_set' ? null : { productId: id })),
			saveStock: vi.fn(async () => undefined),
		};
		const products = { findById: async (id: string) => (id === 'prd_set_a' ? { lowStockThreshold: 3 } : null) };
		const reader = { resolve: async (row: unknown) => row, stock: vi.fn(() => stock) };
		return {
			service: new BundleStockService(bundles as never, products as never, reader as never),
			bundles,
			reader,
		};
	};

	it('refreshes each set holding the pieces once, with its own low-stock line or none, and skips a set gone', async () => {
		const { service, bundles, reader } = setup(async (id) =>
			id === 'prd_piece_1'
				? [{ productId: 'prd_set_a' }, { productId: 'prd_set_b' }, { productId: 'prd_gone_set' }]
				: [{ productId: 'prd_set_a' }],
		);
		expect(await service.refreshContaining(['prd_piece_1', 'prd_piece_2', 'prd_piece_1'])).toBe(3);
		expect(bundles.saveStock).toHaveBeenCalledTimes(2);
		expect(reader.stock).toHaveBeenNthCalledWith(1, expect.anything(), 3);
		expect(reader.stock).toHaveBeenNthCalledWith(2, expect.anything(), null);
	});

	it('never throws when the refresh fails, whatever it throws', async () => {
		expect(
			await setup(async () => Promise.reject(new Error('database down'))).service.refreshContaining(['p']),
		).toBe(0);
		expect(await setup(async () => Promise.reject('not an error')).service.refreshContaining(['p'])).toBe(0);
	});
});

describe('background rounds', () => {
	it('sends due Undo Send messages at start and every round, one round at a time, until shutdown', async () => {
		vi.useFakeTimers();
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		let release: () => void = () => undefined;
		const inbox = {
			dispatchDue: vi
				.fn()
				.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
				.mockRejectedValueOnce(new Error('gmail down'))
				.mockResolvedValue(undefined),
		};
		const dispatcher = new UndoSendDispatcher(inbox as never);
		dispatcher.onApplicationBootstrap();
		expect(inbox.dispatchDue).toHaveBeenCalledTimes(1);
		// A round still running when the next is due is not started twice.
		await vi.advanceTimersByTimeAsync(UNDO_SEND_SWEEP_MS);
		expect(inbox.dispatchDue).toHaveBeenCalledTimes(1);
		release();
		await vi.advanceTimersByTimeAsync(UNDO_SEND_SWEEP_MS);
		await vi.advanceTimersByTimeAsync(UNDO_SEND_SWEEP_MS);
		expect(inbox.dispatchDue).toHaveBeenCalledTimes(3);
		dispatcher.onApplicationShutdown();
		await vi.advanceTimersByTimeAsync(UNDO_SEND_SWEEP_MS * 3);
		expect(inbox.dispatchDue).toHaveBeenCalledTimes(3);
		await expect(dispatcher.round()).resolves.toBeUndefined();
	});

	it('starts nothing while the documentation is built, and stops nothing it never started', () => {
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		const inbox = { dispatchDue: vi.fn() };
		const dispatcher = new UndoSendDispatcher(inbox as never);
		dispatcher.onApplicationBootstrap();
		dispatcher.onApplicationShutdown();
		const sweep = new ShopPaymentSweep({ sweep: vi.fn() } as never);
		sweep.onApplicationBootstrap();
		sweep.onApplicationShutdown();
		expect(inbox.dispatchDue).not.toHaveBeenCalled();
	});

	it('sweeps shop payments every minute, one sweep at a time, carrying on after a failure', async () => {
		vi.useFakeTimers();
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		let release: () => void = () => undefined;
		const payments = {
			sweep: vi
				.fn()
				.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
				.mockRejectedValueOnce(new Error('gateway down'))
				.mockRejectedValueOnce('not an error')
				.mockResolvedValue(undefined),
		};
		const sweep = new ShopPaymentSweep(payments as never);
		sweep.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(SHOP_PAYMENT_SWEEP_MS);
		await vi.advanceTimersByTimeAsync(SHOP_PAYMENT_SWEEP_MS);
		expect(payments.sweep).toHaveBeenCalledTimes(1);
		release();
		await vi.advanceTimersByTimeAsync(SHOP_PAYMENT_SWEEP_MS);
		await vi.advanceTimersByTimeAsync(SHOP_PAYMENT_SWEEP_MS);
		await vi.advanceTimersByTimeAsync(SHOP_PAYMENT_SWEEP_MS);
		expect(payments.sweep).toHaveBeenCalledTimes(4);
		sweep.onApplicationShutdown();
	});
});

describe('bundle builder preview codes', () => {
	const T0 = new Date('2026-11-24T10:00:00.000Z');
	const later = (ms: number) => new Date(T0.getTime() + ms);
	const service = (
		products: unknown = {
			findById: async (id: string) => (id === 'prd_set' ? { id, type: 'bundle' } : { id, type: 'simple' }),
		},
	) =>
		new PagePreviewService(
			{ useCode: async () => null, findSession: async () => ({ layoutId: 'lay_1', revisionId: null }) } as never,
			{
				layout: async () => ({
					id: 'lay_1',
					pageType: 'home',
					draftRevisionId: null,
					lastLiveRevisionId: null,
				}),
				revision: vi.fn(async () => null),
			} as never,
			{
				shopLayout: async () => ({ settings: null }),
				drawn: async (_type: string, revision: unknown) => ({ revision }),
			} as never,
			products as never,
		);

	it('gives a code only for a bundle, and none without the product store', async () => {
		await expect(service(null).bundleCode('adm_1', 'prd_set', T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(service().bundleCode('adm_1', 'prd_saree', T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(service().bundleCode('adm_1', 'prd_missing_store_answer')).rejects.toBeInstanceOf(
			NotFoundException,
		);
		expect((await service().bundleCode('adm_1', 'prd_set')).code).toEqual(expect.any(String));
	});

	it('swaps a bundle code once within its minute, and drops codes past it', async () => {
		const preview = service();
		const { code } = await preview.bundleCode('adm_1', 'prd_set', T0);
		expect(await preview.exchange(code, later(10_000))).toMatchObject({ pageType: 'bundle' });
		const stale = await preview.bundleCode('adm_1', 'prd_set', T0);
		await expect(preview.exchange(stale.code, later(120_000))).rejects.toBeInstanceOf(NotFoundException);
		const old = await preview.bundleCode('adm_1', 'prd_set', T0);
		// Asking again after the minute sweeps the old code away.
		await preview.bundleCode('adm_1', 'prd_set', later(120_000));
		await expect(preview.exchange(old.code, later(10_000))).rejects.toBeInstanceOf(NotFoundException);
	});

	it('draws a layout with no draft and nothing live as empty', async () => {
		const drawn = await service().layout('token', 'en', T0);
		expect(drawn).toEqual({ revision: null });
	});
});

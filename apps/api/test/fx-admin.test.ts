import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Currency, FxSettings, PaymentRoutingSettings } from '@saha-textile/contracts';
import { routePaymentGateway } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { FxAdminService } from '../src/fx/fx-admin.service';
import { fetchRatesIfDue, fetchRatesNow } from '../src/fx/fx-fetch';
import { PaymentRoutingService, gatewayRoutingOf } from '../src/fx/payment-routing.service';

const currency = (code: string, inrPerUnit: number, over: Partial<Currency> = {}): Currency => ({
	code,
	symbol: code,
	enabled: true,
	rateFromINR: 1 / inrPerUnit,
	paypalActive: true,
	paypalPct: 0,
	paypalFixed: 0,
	rateSetBy: 'fetch',
	rateSetById: null,
	rateSetAt: '2026-11-19T07:00:00.000Z',
	...over,
});

function memory(initial: Currency[] = []) {
	const rows = new Map(initial.map((c) => [c.code, c]));
	const store = new Map<string, unknown>();
	return {
		currencies: {
			listAll: async () => [...rows.values()],
			listEnabled: async () => [...rows.values()].filter((c) => c.enabled),
			findByCode: async (code: string) => rows.get(code) ?? null,
			upsert: vi.fn(async (c: Currency) => (rows.set(c.code, c), c)),
		},
		settings: {
			get: vi.fn(async (key: string) => store.get(key) ?? null),
			set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
		},
		rows,
		store,
	};
}

const harness = (initial: Currency[] = [], options: { superAdmin?: boolean; rates?: Record<string, number> } = {}) => {
	const repo = memory(initial);
	const fx = {
		usesKey: false,
		getAllRatesFromINR: vi.fn(async () => options.rates ?? { USD: 1 / 88.42, GBP: 1 / 116.95 }),
		getRateFromINR: vi.fn(),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new FxAdminService(
		repo.settings as never,
		repo.currencies as never,
		fx,
		{ findByKey: async () => ({ id: 'role-super' }) } as never,
		{ findActive: async () => (options.superAdmin ? { id: 'a' } : null) } as never,
		{ findById: async (id: string) => (id === 'admin-1' ? { displayName: 'Moulik Patra' } : null) } as never,
		audit as never,
	);
	return { service, repo, fx, audit };
};

describe('Admin › Currencies (brief fx01–fx03)', () => {
	it('lists the launch currencies with their rates, who set them and a ₹10,000 example with the markup', async () => {
		const { service } = harness([
			currency('INR', 1),
			currency('USD', 88.42),
			currency('EUR', 101.8, { rateSetBy: 'staff', rateSetById: 'admin-1' }),
			currency('JPY', 0.58),
		]);
		const overview = await service.overview('admin-1');
		expect(overview.currencies.map((c) => c.code)).toEqual([
			'USD',
			'GBP',
			'EUR',
			'CAD',
			'AUD',
			'SGD',
			'NZD',
			'JPY',
		]);
		expect(overview.currencies[0]).toMatchObject({ inrPerUnit: 88.42, setBy: 'fetch', examplePrice: 119.88 });
		// A launch currency with no rate yet: listed, off, nothing invented.
		expect(overview.currencies[1]).toMatchObject({ code: 'GBP', symbol: '£', stored: false, inrPerUnit: null });
		expect(overview.currencies[2]).toMatchObject({
			setBy: 'staff',
			setByName: 'Moulik Patra',
			examplePrice: 104.13,
		});
		expect(overview.settings.paypalMarkupPercent).toBe(6);
		expect(overview.canEditMarkup).toBe(false);
	});

	it('only a super admin changes the markup; a stale save and PayPal’s rates before approval are refused', async () => {
		const plain = harness();
		const write = (
			over: Partial<{ paypalMarkupPercent: number; source: 'stored' | 'paypalFxaas'; revision: number }> = {},
		) => ({
			source: 'stored' as const,
			paypalMarkupPercent: 6,
			dailyFetch: { enabled: false, time: '12:30' },
			revision: 0,
			...over,
		});
		await expect(plain.service.saveSettings(write({ paypalMarkupPercent: 7 }), 'admin-1')).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		// The code travels in issues, the one channel the exception filter keeps (common/coded-refusal.ts).
		await plain.service
			.saveSettings(write({ paypalMarkupPercent: 7 }), 'admin-1')
			.catch((error: ForbiddenException) =>
				expect(error.getResponse()).toMatchObject({ issues: [{ code: 'super_admin_only' }] }),
			);
		await expect(plain.service.saveSettings(write({ source: 'paypalFxaas' }), 'admin-1')).rejects.toBeInstanceOf(
			BadRequestException,
		);
		// Other settings save without the super admin.
		expect((await plain.service.saveSettings(write(), 'admin-1')).settings).toMatchObject({
			dailyFetch: { enabled: false, time: '12:30' },
			revision: 1,
			updatedBy: 'admin-1',
		});
		await expect(plain.service.saveSettings(write(), 'admin-1')).rejects.toBeInstanceOf(ConflictException);

		const boss = harness([], { superAdmin: true });
		const saved = await boss.service.saveSettings(write({ paypalMarkupPercent: 7 }), 'admin-2');
		expect(saved.settings.paypalMarkupPercent).toBe(7);
		expect(saved.canEditMarkup).toBe(true);
		expect(boss.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'fx.settings.update' }));
	});

	it('takes a typed rate as ₹ per unit, creates a launch currency the first time, and refuses rupees', async () => {
		const { service, repo } = harness([currency('INR', 1)]);
		const after = await service.setRate('gbp', { inrPerUnit: 116.95 }, 'admin-1');
		expect(after.currencies.find((c) => c.code === 'GBP')).toMatchObject({
			stored: true,
			enabled: true,
			inrPerUnit: 116.95,
			setBy: 'staff',
			setByName: 'Moulik Patra',
			examplePrice: 90.64,
		});
		expect(repo.rows.get('GBP')?.symbol).toBe('£');
		await service.setRate('GBP', { enabled: false }, 'admin-1');
		expect(repo.rows.get('GBP')).toMatchObject({ enabled: false, rateSetBy: 'staff' });
		await expect(service.setRate('INR', { inrPerUnit: 1 }, null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.setRate('CAD', { enabled: true }, null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.setRate('dollars', { inrPerUnit: 1 }, null)).rejects.toBeInstanceOf(BadRequestException);
	});

	it('fetches now: rates stored and the time noted; a failure keeps the stored rates and says why', async () => {
		const { service, repo } = harness([currency('USD', 80)]);
		const result = await service.fetchNow('admin-1');
		expect(result).toMatchObject({ ok: true, updated: expect.arrayContaining(['USD', 'GBP']), problem: null });
		expect(repo.rows.get('USD')?.rateFromINR).toBeCloseTo(1 / 88.42);
		expect((repo.store.get('fx') as FxSettings).dailyFetch.lastRunAt).toBe(result.at);

		const broken = memory([currency('USD', 80)]);
		const failed = await fetchRatesNow({
			settings: broken.settings,
			currencies: broken.currencies,
			fx: { getAllRatesFromINR: async () => Promise.reject(new Error('ExchangeRate-API answered 503')) },
		});
		expect(failed).toMatchObject({ ok: false, updated: [], problem: 'ExchangeRate-API answered 503' });
		expect(broken.rows.get('USD')?.rateFromINR).toBe(1 / 80);
		expect((broken.store.get('fx') as FxSettings).dailyFetch).toMatchObject({
			lastRunAt: null,
			lastError: 'ExchangeRate-API answered 503',
		});
	});

	it('the worker’s check fetches only when due', async () => {
		const repo = memory();
		const fx = { getAllRatesFromINR: vi.fn(async () => ({ USD: 0.0113 })) };
		const deps = { settings: repo.settings, currencies: repo.currencies, fx };
		expect(await fetchRatesIfDue(deps, new Date('2026-11-19T06:00:00.000Z'))).toBeNull();
		expect(fx.getAllRatesFromINR).not.toHaveBeenCalled();
		expect(await fetchRatesIfDue(deps, new Date('2026-11-19T07:05:00.000Z'))).toMatchObject({ ok: true });
		expect(await fetchRatesIfDue(deps, new Date('2026-11-19T07:20:00.000Z'))).toBeNull();
	});
});

describe('Settings › Payment method (brief pay01)', () => {
	const build = (merchantId?: string) => {
		const repo = memory();
		const audit = { append: vi.fn(async () => undefined) };
		const config = { payments: { ccavenue: { merchantId } } };
		return { service: new PaymentRoutingService(repo.settings as never, config as never, audit as never), audit };
	};

	it('starts on CCAvenue for rupees and PayPal for the rest, and says only whether keys are set', async () => {
		const view = await build('M-1').service.view();
		expect(view.settings).toMatchObject({
			activeInrGateway: 'ccavenue',
			paypalTakesNewPayments: true,
			popups: { paypalChooseCurrency: true, inrCardRefused: true },
		});
		expect(view.keysOnServer).toEqual({ ccavenue: true, razorpay: false, paypal: false });
		expect(JSON.stringify(view)).not.toContain('M-1');
		expect((await build().service.view()).keysOnServer.ccavenue).toBe(false);
	});

	it('saves by revision, refuses a gateway not built yet, and routes by currency', async () => {
		const { service, audit } = build();
		const current = (await service.view()).settings;
		const { updatedAt: _a, updatedBy: _b, ...write } = current;
		void _a;
		void _b;
		await expect(service.save({ ...write, activeInrGateway: 'razorpay' }, null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		const saved = await service.save({ ...write, paypalTakesNewPayments: false }, 'admin-1');
		expect(saved.settings).toMatchObject({ paypalTakesNewPayments: false, revision: 1 });
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.routing.update' }));
		await expect(service.save(write, null)).rejects.toBeInstanceOf(ConflictException);

		const routing = gatewayRoutingOf(saved.settings as PaymentRoutingSettings);
		expect(routePaymentGateway('INR', routing)).toEqual({ gateway: 'ccavenue' });
		expect(routePaymentGateway('GBP', routing)).toEqual({ problem: 'noForeignGateway' });
	});
});

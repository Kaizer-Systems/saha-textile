import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { CurrencyModel, NotificationTemplateModel, RoleModel } from '../src/models/index';
import { MongoCurrencyRepository } from '../src/repositories/index';
import { seedFirstRun } from '../src/seed/first-run';
import { seedCurrencies } from '../src/seed/data';
import { CATALOG_NOTIFICATION_TEMPLATES } from '../src/seed/notification-templates';
import { hasMongoEnv } from './mongo-test-env';

describe.skipIf(!hasMongoEnv())('first-run setup (integration)', () => {
	const codes = seedCurrencies.map((currency) => currency.code);
	const keys = CATALOG_NOTIFICATION_TEMPLATES.map((template) => template.key);
	const clear = async () => {
		await CurrencyModel.deleteMany({ code: { $in: codes } });
		await NotificationTemplateModel.deleteMany({ key: { $in: keys } });
	};

	beforeAll(async () => {
		await connectMongo();
		await clear();
	});

	afterAll(async () => {
		await clear();
		await disconnectMongo();
	});

	it('adds what is missing, then leaves what staff changed alone', async () => {
		await expect(seedFirstRun()).resolves.toEqual({ currencies: codes.length, templates: keys.length });
		expect(await RoleModel.countDocuments({ key: 'administrator' })).toBe(1);

		const currencies = new MongoCurrencyRepository();
		const usd = await currencies.findByCode('USD');
		await currencies.upsert({ ...usd!, rateFromINR: 0.5 });

		await expect(seedFirstRun()).resolves.toEqual({ currencies: 0, templates: 0 });
		expect((await currencies.findByCode('USD'))?.rateFromINR).toBe(0.5);
	});
});

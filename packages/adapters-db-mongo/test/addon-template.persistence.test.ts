import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { AddonTemplateModel } from '../src/models/merchandising.model';
import { MongoAddonTemplateRepository } from '../src/repositories/addon-template.repository';

/**
 * A price edit from the admin's add-on list must not replace a template's measurement fields.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const field = (code: string, min: number, max: number) => ({
	code,
	label: { en: code },
	type: 'number',
	unit: 'in',
	required: true,
	validation: { min, max, step: 0.5 },
});

describe.runIf(hasMongoEnv())('add-on template persistence (rs0)', () => {
	const repo = new MongoAddonTemplateRepository();
	const code = `it-blouse-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		await connectMongo();
		await AddonTemplateModel.create({
			_id: randomUUID(),
			code,
			label: 'Blouse measurements',
			priceINR: 0,
			fields: [field('shoulder', 10, 24), field('chest', 24, 50), field('waist', 22, 48), field('sleeve', 4, 26)],
		});
	});

	afterAll(async () => {
		await AddonTemplateModel.deleteMany({ code }).exec();
		await disconnectMongo();
	});

	it('keeps every field through a save of the whole template', async () => {
		const before = await repo.findByCode(code);
		await repo.save({ code, label: { en: 'Blouse measurements' }, priceINR: 900, fields: before?.fields ?? [] });

		const saved = await repo.findByCode(code);
		expect(saved?.priceINR).toBe(900);
		expect(saved?.fields.map((row) => [row.code, row.min, row.max])).toEqual([
			['shoulder', 10, 24],
			['chest', 24, 50],
			['waist', 22, 48],
			['sleeve', 4, 26],
		]);
	});
});

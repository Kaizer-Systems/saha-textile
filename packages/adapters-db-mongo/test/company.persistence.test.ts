import { randomUUID } from 'node:crypto';

import { CompanyProfile, FeatureSwitches, GstRegistration, gstinCheckCharacter } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { CompanyProfileModel, FeatureSwitchesModel, GstRegistrationModel } from '../src/models/company.model';
import { MongoCompanyRepository } from '../src/repositories/company.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Company setup persistence (accounts brief J, CT, G1–G2) against a real replica set.
 * Always run against the test database:
 *   RUN_DB_IT=1 MONGODB_DB_NAME=saha_textile_test pnpm --filter @saha-textile/adapters-db-mongo test
 */

describe.skipIf(!hasMongoEnv())('company setup persistence (integration, rs0)', () => {
	const repo = new MongoCompanyRepository();
	const stamp = () => new Date().toISOString();
	const GSTIN = `19AAPFU0939F1Z${gstinCheckCharacter('19AAPFU0939F1Z')}`;

	beforeAll(async () => {
		await connectMongo();
		await GstRegistrationModel.syncIndexes();
		await CompanyProfileModel.deleteMany({});
		await GstRegistrationModel.deleteMany({});
		await FeatureSwitchesModel.deleteMany({});
	});
	afterAll(async () => {
		await CompanyProfileModel.deleteMany({});
		await GstRegistrationModel.deleteMany({});
		await FeatureSwitchesModel.deleteMany({});
		await disconnectMongo();
	});

	it('saves the profile once, then only over the copy the editor read', async () => {
		const first = CompanyProfile.parse({ kind: 'partnership', legalName: 'Example Firm', updatedAt: stamp() });
		await repo.saveProfile(first, null);
		expect((await repo.getProfile())?.legalName).toBe('Example Firm');
		await expect(repo.saveProfile({ ...first, legalName: 'Second first save' }, null)).rejects.toBeInstanceOf(
			StaleVersionError,
		);
		const next = { ...first, legalName: 'Renamed', updatedAt: stamp() };
		await repo.saveProfile(next, first.updatedAt);
		await expect(repo.saveProfile({ ...next, legalName: 'Stale' }, first.updatedAt)).rejects.toBeInstanceOf(
			StaleVersionError,
		);
		expect((await repo.getProfile())?.legalName).toBe('Renamed');
	});

	it('keeps one registration per GSTIN with its dated terms', async () => {
		const id = `gst_${randomUUID()}`;
		const terms = [{ from: '2026-04-01', kind: 'regular', scheme: 'monthly', lastYearTurnoverINR: 24_860_000 }];
		const reg = GstRegistration.parse({
			id,
			gstin: GSTIN,
			stateCode: '19',
			terms,
			createdAt: stamp(),
			updatedAt: stamp(),
		});
		await repo.saveRegistration(reg, null);
		expect((await repo.findRegistrationByGstin(GSTIN))?.id).toBe(id);
		expect((await repo.getRegistration(id))?.gstin).toBe(GSTIN);
		expect(await repo.getRegistration(`gst_${randomUUID()}`)).toBeNull();
		const twin = GstRegistration.parse({ ...reg, id: `gst_${randomUUID()}` });
		await expect(repo.saveRegistration(twin, null)).rejects.toBeInstanceOf(StaleVersionError);
		expect((await repo.listRegistrations()).map((row) => row.terms[0]?.scheme)).toEqual(['monthly']);
	});

	it('saves the feature switches with the same guard', async () => {
		const features = FeatureSwitches.parse({ on: { locations: true }, updatedAt: stamp() });
		await repo.saveFeatures(features, null);
		expect((await repo.getFeatures())?.on.locations).toBe(true);
		await expect(repo.saveFeatures(features, null)).rejects.toBeInstanceOf(StaleVersionError);
	});
});

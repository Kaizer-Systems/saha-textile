import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { DocumentFormatModel, ProductDraftModel } from '../src/models/index';
import { MongoDocumentFormatRepository } from '../src/repositories/document-format.repository';
import { MongoProductDraftRepository } from '../src/repositories/product-draft.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Product drafts and document formats against the real replica set, on this run's rows only. The formats use a
 * document kind of their own, so the one-active-format rule never touches the real documents' formats.
 */
describe.runIf(hasMongoEnv())('product drafts and document formats (rs0)', () => {
	const P = runPrefix('drafts');
	const drafts = new MongoProductDraftRepository();
	const formats = new MongoDocumentFormatRepository();
	const kind = `${P}doc` as never;
	const at = '2026-11-20T10:00:00.000Z';

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await ProductDraftModel.deleteMany({ _id: ours }).exec();
		await DocumentFormatModel.deleteMany({ _id: ours }).exec();
		await disconnectMongo();
	});

	it('saves, finds, lists, counts and removes product drafts', async () => {
		const draft = (key: string, over: Record<string, unknown> = {}) =>
			({
				id: `${P}${key}`,
				kind: 'edit',
				productId: `${P}product`,
				title: `Red Banarasi ${key}`,
				imageAssetId: null,
				form: {},
				changes: [],
				toFix: 0,
				baseSavedAt: at,
				createdBy: `${P}staff`,
				updatedBy: `${P}staff`,
				createdAt: at,
				updatedAt: at,
				...over,
			}) as never;
		expect((await drafts.save(draft('one'))).baseSavedAt).toBe(at);
		await drafts.save(draft('two', { kind: 'new', productId: null, baseSavedAt: null, title: 'Blue Tant' }));
		await insertRaw(ProductDraftModel as never, {
			_id: `${P}bare`,
			kind: 'new',
			createdBy: `${P}other`,
			createdAt: new Date(at),
			updatedAt: new Date(at),
		});
		expect((await drafts.findById(`${P}one`))?.title).toBe('Red Banarasi one');
		expect(await drafts.findById(`${P}none`)).toBeNull();
		expect(await drafts.findById(`${P}bare`)).toMatchObject({
			title: '',
			productId: null,
			form: {},
			changes: [],
			toFix: 0,
			baseSavedAt: null,
		});
		expect((await drafts.findEdit(`${P}product`, `${P}staff`))?.id).toBe(`${P}one`);
		expect(await drafts.findEdit(`${P}product`, `${P}nobody`)).toBeNull();
		const searched = await drafts.list({
			createdBy: `${P}staff`,
			productId: `${P}product`,
			search: ' red  banarasi ',
			page: 1,
			pageSize: 10,
		} as never);
		expect(searched.items.map((row) => row.id)).toEqual([`${P}one`]);
		expect((await drafts.list({ createdBy: `${P}staff`, page: 1, pageSize: 10 } as never)).total).toBe(2);
		expect(await drafts.countBy(`${P}staff`)).toBe(2);
		await drafts.remove(`${P}two`);
		expect(await drafts.removeForProduct(`${P}product`)).toBe(1);
		expect(await drafts.countBy(`${P}staff`)).toBe(0);
	});

	it('creates, finds, updates and switches document formats, one active per document', async () => {
		const format = (key: string, active: boolean) =>
			({
				id: `${P}${key}`,
				doc: kind,
				name: `Format ${key}`,
				about: '',
				paper: 'a4',
				blocks: [],
				active,
				seeded: false,
				version: 1,
				updatedAt: null,
				updatedBy: null,
			}) as never;
		await formats.create(format('a', true));
		await formats.create(format('b', false));
		await insertRaw(DocumentFormatModel as never, {
			_id: `${P}bare`,
			doc: `${P}other`,
			name: 'Bare',
			updatedAt: new Date(at),
		});
		expect((await formats.list()).some((row) => row.id === `${P}a`)).toBe(true);
		expect(await formats.findById(`${P}bare`)).toMatchObject({
			about: '',
			paper: 'a4',
			blocks: [],
			active: false,
			seeded: false,
			version: 1,
			updatedAt: at,
		});
		expect(await formats.findById(`${P}none`)).toBeNull();
		expect((await formats.findActive(kind))?.id).toBe(`${P}a`);
		expect(await formats.findActive(`${P}nothing` as never)).toBeNull();
		expect(
			(await formats.update({ ...(format('b', false) as object), name: 'Renamed' } as never, 1))?.version,
		).toBe(2);
		expect(await formats.update(format('b', false), 1)).toBeNull();
		const switched = await formats.switchOn(`${P}b`, `${P}staff`);
		expect(switched?.on.id).toBe(`${P}b`);
		expect(switched?.off?.id).toBe(`${P}a`);
		expect((await formats.switchOn(`${P}b`, `${P}staff`))?.off).toBeNull();
		expect(await formats.switchOn(`${P}none`, `${P}staff`)).toBeNull();
	});
});

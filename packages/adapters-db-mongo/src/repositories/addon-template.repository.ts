import { randomUUID } from 'node:crypto';

import type { AddonTemplateRepository, AddonTemplateRow } from '@saha-textile/core-domain';

import { AddonTemplateModel, type AddonTemplateDoc } from '../models/merchandising.model';

interface StoredField {
	code?: string;
	label?: Record<string, string> | string;
	unit?: 'in' | 'cm';
	validation?: { min?: number; max?: number; step?: number };
}

/** Older rows hold one English string. */
const text = (value: Record<string, string> | string | undefined, fallback: string): Record<string, string> =>
	typeof value === 'string' ? { en: value } : (value ?? { en: fallback });

const toRow = (doc: AddonTemplateDoc): AddonTemplateRow => ({
	code: doc.code,
	label: text(doc.label, doc.code),
	priceINR: doc.priceINR,
	fields: ((doc.fields ?? []) as StoredField[]).flatMap((field) =>
		field.code
			? [
					{
						code: field.code,
						label: text(field.label, field.code),
						unit: field.unit === 'cm' ? ('cm' as const) : ('in' as const),
						min: field.validation?.min ?? null,
						max: field.validation?.max ?? null,
						step: field.validation?.step ?? null,
					},
				]
			: [],
	),
	sizeGuide: doc.sizeGuide ?? [],
});

export class MongoAddonTemplateRepository implements AddonTemplateRepository {
	async list() {
		const docs = await AddonTemplateModel.find().lean<AddonTemplateDoc[]>().exec();
		return docs.map(toRow);
	}

	async findByCode(code: string) {
		const doc = await AddonTemplateModel.findOne({ code }).lean<AddonTemplateDoc>().exec();
		return doc ? toRow(doc) : null;
	}

	async save(row: AddonTemplateRow) {
		const existing = await AddonTemplateModel.findOne({ code: row.code }).lean<AddonTemplateDoc>().exec();
		const fields = row.fields.map(({ code, label, unit, min, max, step }) => ({
			code,
			label,
			type: 'number',
			unit,
			required: false,
			validation: { ...(min === null ? {} : { min }), ...(max === null ? {} : { max }), ...(step === null ? {} : { step }) },
		}));
		await AddonTemplateModel.updateOne(
			{ _id: existing?._id ?? randomUUID() },
			{ $set: { code: row.code, label: row.label, priceINR: row.priceINR, fields, sizeGuide: row.sizeGuide } },
			{ upsert: true },
		).exec();
		return row;
	}

	async remove(code: string): Promise<void> {
		await AddonTemplateModel.deleteOne({ code }).exec();
	}
}

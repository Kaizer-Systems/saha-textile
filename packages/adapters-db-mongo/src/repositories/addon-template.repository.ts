import { randomUUID } from 'node:crypto';

import type { AddonTemplateRepository } from '@saha-textile/core-domain';

import { AddonTemplateModel, type AddonTemplateDoc } from '../models/merchandising.model';

export class MongoAddonTemplateRepository implements AddonTemplateRepository {
	async list() {
		const docs = await AddonTemplateModel.find().lean<AddonTemplateDoc[]>().exec();
		return docs.map((doc) => {
			const field = (doc.fields?.[0] ?? {}) as {
				unit?: 'in' | 'cm';
				validation?: { min?: number; max?: number; step?: number };
			};
			return {
				code: doc.code,
				label: doc.label,
				priceINR: doc.priceINR,
				...(field.unit ? { unit: field.unit } : {}),
				...(field.validation?.min !== undefined ? { min: field.validation.min } : {}),
				...(field.validation?.max !== undefined ? { max: field.validation.max } : {}),
				...(field.validation?.step !== undefined ? { step: field.validation.step } : {}),
			};
		});
	}

	async findByCode(code: string) {
		const doc = await AddonTemplateModel.findOne({ code }).lean<AddonTemplateDoc>().exec();
		if (!doc) return null;
		const fields = (doc.fields ?? []) as Array<{
			code?: string;
			label?: Record<string, string> | string;
			unit?: 'in' | 'cm';
			validation?: { min?: number; max?: number; step?: number };
		}>;
		return {
			code: doc.code,
			label: doc.label,
			priceINR: doc.priceINR,
			fields: fields
				.filter((field) => field.code)
				.map((field) => ({
					code: field.code!,
					label: typeof field.label === 'string' ? field.label : (field.label?.['en'] ?? field.code!),
					unit: field.unit === 'cm' ? ('cm' as const) : ('in' as const),
					min: field.validation?.min ?? null,
					max: field.validation?.max ?? null,
					step: field.validation?.step ?? null,
				})),
		};
	}

	async save(row: {
		code: string;
		label: string;
		priceINR: number;
		unit?: 'in' | 'cm';
		min?: number;
		max?: number;
		step?: number;
	}) {
		const existing = await AddonTemplateModel.findOne({ code: row.code }).lean<AddonTemplateDoc>().exec();
		const id = existing?._id ?? randomUUID();
		// One unit/min/max/step cannot describe a template with several fields, so an existing
		// field list is kept; only a template without fields gets one from them.
		const kept = existing?.fields ?? [];
		const fields =
			kept.length === 0 && (row.unit || row.min !== undefined || row.max !== undefined || row.step !== undefined)
				? [
						{
							code: row.code,
							label: { en: row.label },
							type: 'number',
							unit: row.unit,
							required: false,
							validation: { min: row.min, max: row.max, step: row.step },
						},
					]
				: kept;
		await AddonTemplateModel.updateOne(
			{ _id: id },
			{ $set: { code: row.code, label: row.label, priceINR: row.priceINR, fields } },
			{ upsert: true },
		).exec();
		return row;
	}

	async remove(code: string): Promise<void> {
		await AddonTemplateModel.deleteOne({ code }).exec();
	}
}

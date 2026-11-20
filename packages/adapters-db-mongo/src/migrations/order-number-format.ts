import { SiteSettingModel } from '../models/index';

/**
 * Migration 0011 (OD18 Final, owner 2026-11-20): the order number is `ST-YYMM-NNNNNN`. A database whose
 * numbering setting still holds the interim shape written by migration 0010 (`ST-#####-#####`) moves
 * to the owner's format; a format staff chose some other way is left alone. Order numbers already
 * issued keep their own form.
 */
export async function setOwnerOrderNumberFormat(): Promise<string> {
	const result = await SiteSettingModel.updateOne(
		{
			_id: 'orders.numbering',
			'value.order.kind': 'randomGroups',
			'value.order.prefix': 'ST',
			'value.order.groups': [5, 5],
		},
		{
			$set: { 'value.order': { kind: 'yearMonthRandom', prefix: 'ST', separator: '-', randomDigits: 6 } },
			$unset: { 'value.orderFormatChosenByOwner': '' },
		},
	).exec();
	return result.modifiedCount ? 'order number format set to ST-YYMM-NNNNNN' : 'order number format already set';
}

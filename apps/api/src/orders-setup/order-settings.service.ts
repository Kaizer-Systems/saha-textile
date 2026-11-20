import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
	DocumentNumberingSettings,
	GST_DOCUMENT_TYPES,
	NumberedDocumentType,
	OrderSettings,
	type DocumentNumberingRow,
	type DocumentNumberingWrite,
	type OrderSettingsWrite,
} from '@saha-textile/contracts';
import {
	fiscalYearOf,
	istDay,
	numberingExamples,
	seriesFormatProblems,
	type AuditLogRepository,
	type DocumentNumberingRepository,
	type OrderSettingsRepository,
} from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY, DOCUMENT_NUMBERING_REPOSITORY, ORDER_SETTINGS_REPOSITORY } from '../infra/tokens';
import { auditOrdersChange, refuseStale } from './orders-audit';

/**
 * Settings › Orders (named order settings) and document numbers (`DEC-NUMBERING`; table accepted
 * 2026-11-20 except the order row, which stays a setting). A series that has issued a number is
 * locked; GST formats must fit 16 characters; every series stays unique once separators go.
 */
@Injectable()
export class OrderSettingsService {
	constructor(
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(DOCUMENT_NUMBERING_REPOSITORY) private readonly numbering: DocumentNumberingRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	getSettings(): Promise<OrderSettings> {
		return this.settings.get();
	}

	async saveSettings(input: OrderSettingsWrite, actor: string | null): Promise<OrderSettings> {
		const next = OrderSettings.parse({ ...input, updatedAt: new Date().toISOString(), updatedBy: actor });
		const saved = await refuseStale(
			() => this.settings.save(next, input.revision),
			'Someone else changed the order settings first',
		);
		await auditOrdersChange(this.audit, actor, 'orders.settings', 'settings', null, { ...input });
		return saved;
	}

	async getNumbering(): Promise<{ settings: DocumentNumberingSettings; rows: DocumentNumberingRow[] }> {
		const settings = await this.numbering.get();
		return { settings, rows: this.rows(settings) };
	}

	async saveNumbering(
		input: DocumentNumberingWrite,
		actor: string | null,
	): Promise<{ settings: DocumentNumberingSettings; rows: DocumentNumberingRow[] }> {
		const current = await this.numbering.get();
		const next = DocumentNumberingSettings.parse({
			...current,
			...input,
			lockedTypes: current.lockedTypes,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		});
		const issues = NumberedDocumentType.options.flatMap((type) =>
			seriesFormatProblems(type, next.series[type], next, current.series[type]).map((problem) => ({
				path: `series.${type}`,
				message: problem,
				code: problem,
			})),
		);
		if (issues.length) throw new BadRequestException({ message: 'Validation failed', issues });
		const saved = await refuseStale(
			() => this.numbering.save(next, input.revision),
			'Someone else changed the number formats first',
		);
		await auditOrdersChange(this.audit, actor, 'orders.numbering', 'settings', null, { order: saved.order });
		return { settings: saved, rows: this.rows(saved) };
	}

	private rows(settings: DocumentNumberingSettings): DocumentNumberingRow[] {
		const examples = numberingExamples(settings, fiscalYearOf(istDay(new Date())));
		const fixed: DocumentNumberingRow[] = (['order', 'parcel', 'return', 'paymentRequest'] as const).map(
			(type) => ({
				type,
				example: examples[type] ?? '',
				resetsEachYear: type === 'order' ? settings.order.kind === 'financialYearSequence' : false,
				locked: false,
				gst: false,
			}),
		);
		return [
			...fixed,
			...NumberedDocumentType.options.map((type) => ({
				type,
				example: examples[type] ?? '',
				resetsEachYear: settings.series[type].reset === 'fy',
				locked: settings.lockedTypes.includes(type),
				gst: GST_DOCUMENT_TYPES.includes(type),
			})),
		];
	}
}

import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	SalaryHead,
	StructurePreview,
	SalaryTemplate,
	SalaryTemplateEdit,
	SalaryTemplateWrite,
	StructureComponentWrite,
} from '@saha-textile/contracts';
import {
	gratuityProvision,
	monthPay,
	SALARY_HEADS,
	structureFromCtc,
	structureFromTemplate,
	wageShortfall,
	wageTreatment,
	type SalaryStructure,
	type SalaryTemplateRepository,
} from '@saha-textile/core-domain';

import { SALARY_TEMPLATE_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { PayrollRulesService } from './payroll-rules.service';

const paise = (inr: number) => Math.round(inr * 100);

/** A template's lines in paise (fixed amounts are typed in rupees). */
const inPaise = (components: readonly StructureComponentWrite[]) =>
	components.map((c) => ({ ...c, value: c.how === 'fixed' ? paise(c.value) : c.value }));

/** Salary structure templates (accounts brief S4): a % of pay, a fixed amount or the rest, per head. */
@Injectable()
export class SalaryTemplatesService {
	constructor(
		@Inject(SALARY_TEMPLATE_REPOSITORY) private readonly store: SalaryTemplateRepository,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
	) {}

	list(): Promise<SalaryTemplate[]> {
		return this.store.list();
	}

	/** S4: what a template gives on a monthly pay, and how much of it counts as wages. */
	preview(components: readonly StructureComponentWrite[], payINR: number): StructurePreview {
		return this.shown(components, structureFromTemplate(inPaise(components), paise(payINR)));
	}

	/**
	 * Brief 26 SR1: what a template gives from a yearly CTC: a month's CTC split with the employer's PF, ESI and
	 * gratuity inside it, by this month's rules, for someone on PF and ESI.
	 */
	async previewCtc(
		components: readonly StructureComponentWrite[],
		ctcYearINR: number,
		now = new Date(),
	): Promise<StructurePreview> {
		const month = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
		const { pay: rules, schemes } = await this.rules.forMonth(month);
		const split = structureFromCtc(inPaise(components), Math.round(paise(ctcYearINR) / 12), (s) => {
			const p = monthPay({
				structure: s,
				daysInMonth: 30,
				paidDays: 30,
				pfOn: true,
				esiOn: true,
				advanceDuePaise: 0,
				tdsPaise: 0,
				rules,
				ptFor: () => 0,
			});
			return p.pfEmployerPaise + p.esiEmployerPaise + gratuityProvision(s, true, schemes);
		});
		return {
			...this.shown(components, split.structure),
			employerINR: split.employerPaise / 100,
			ctcMonthINR: (split.grossPaise + split.employerPaise) / 100,
			fits: split.fits,
		};
	}

	private shown(components: readonly StructureComponentWrite[], s: SalaryStructure): StructurePreview {
		const total = SALARY_HEADS.reduce((sum, head) => sum + s[head], 0);
		const structure = Object.fromEntries(SALARY_HEADS.map((h) => [h, s[h] / 100])) as Record<SalaryHead, number>;
		return {
			structure,
			lines: components.map((c) => ({ head: c.head, inr: s[c.head] / 100, treatment: wageTreatment(c.head) })),
			totalINR: total / 100,
			basicSharePct: total ? Math.round(((s.basic + s.da) / total) * 1000) / 10 : 0,
			shortfallINR: wageShortfall(s) / 100,
		};
	}

	async create(write: SalaryTemplateWrite, now = new Date()): Promise<SalaryTemplate> {
		const template: SalaryTemplate = {
			...write,
			id: `sst_${randomUUID()}`,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			version: 0,
		};
		await this.store.insert(template);
		return template;
	}

	async update(id: string, edit: SalaryTemplateEdit, now = new Date()): Promise<SalaryTemplate> {
		const current = await this.store.get(id);
		if (!current) throw new NotFoundException(accountsRefusal('salary_template_not_found'));
		const { version, ...write } = edit;
		try {
			return await this.store.save({ ...current, ...write, updatedAt: now.toISOString() }, version);
		} catch (error) {
			if (error instanceof Error && error.message === 'salary_template_changed')
				throw new ConflictException(accountsRefusal('salary_template_changed'));
			throw error;
		}
	}
}

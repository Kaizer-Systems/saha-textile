import { describe, expect, it } from 'vitest';

import {
	CashMoveWrite,
	CashSettleWrite,
	CashSheetListQuery,
	ClaimDecisionWrite,
	ClaimListQuery,
	DEFAULT_CASH_RULES,
	DEFAULT_DENOMINATIONS,
	ExpenseClaimWrite,
	PettyCheckQuery,
	PettyExpenseWrite,
	PettyListQuery,
	RefillWrite,
} from '../src/cash';
import { DEFAULT_DOCUMENT_NUMBERING, DEFAULT_SERIES, DocumentNumberingSettings } from '../src/document-numbering';

/** Cash (accounts brief O) and the petty cash and claim number series. */

describe('cash contracts', () => {
	it('starts with the notes and coins in circulation on, and a manager for every difference', () => {
		expect(DEFAULT_DENOMINATIONS.filter((d) => d.on)).toHaveLength(11);
		expect(DEFAULT_CASH_RULES).toEqual({ billPhotoOverPaise: 50_000, suspenseDays: 30, autoAcceptUpToPaise: 0 });
	});

	it('refuses an amount of nothing and a period that ends before it starts', () => {
		expect(CashMoveWrite.safeParse({ kind: 'bank_deposit', amountPaise: 0, toId: 'led_hdfc' }).success).toBe(false);
		expect(CashMoveWrite.parse({ kind: 'bank_deposit', amountPaise: 100, toId: 'led_hdfc' })).toMatchObject({
			slip: '',
			note: '',
		});
		const petty = { boxId: 'b', headLedgerId: 'h', paidTo: 'x', whatFor: 'y' };
		expect(PettyExpenseWrite.safeParse({ ...petty, amountPaise: 0 }).success).toBe(false);
		expect(PettyExpenseWrite.parse({ ...petty, amountPaise: 5 }).gst).toBeNull();
		expect(RefillWrite.safeParse({ fromLedgerId: 'l', amountPaise: 0 }).success).toBe(false);
		expect(RefillWrite.parse({ fromLedgerId: 'l', amountPaise: 1 }).amountPaise).toBe(1);
		const claim = { locationId: 'l', headLedgerId: 'h', whatFor: 'x', spentOn: '2026-11-21' };
		expect(ExpenseClaimWrite.safeParse({ ...claim, amountPaise: 0 }).success).toBe(false);
		expect(ExpenseClaimWrite.parse({ ...claim, amountPaise: 1 }).staffUserId).toBeNull();
		for (const schema of [CashSheetListQuery, PettyListQuery, ClaimListQuery]) {
			expect(schema.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success).toBe(false);
			expect(schema.parse({ from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ page: 1, pageSize: 25 });
		}
		expect(PettyCheckQuery.parse({ boxId: 'b', amountPaise: '120' }).amountPaise).toBe(120);
	});

	it('takes a settlement without the system’s own way, and a decision to approve or reject', () => {
		expect(CashSettleWrite.safeParse({ how: 'auto_accepted', version: 0 }).success).toBe(false);
		expect(CashSettleWrite.parse({ how: 'write_off', version: 0 })).toMatchObject({
			consent: false,
			insured: false,
		});
		expect(ClaimDecisionWrite.parse({ decision: 'approve', payBack: 'salary', version: 0 })).toMatchObject({
			payBoxId: null,
		});
		expect(ClaimDecisionWrite.safeParse({ decision: 'reject', reason: '', version: 0 }).success).toBe(false);
	});
});

describe('the petty cash and claim number series', () => {
	it('gives settings saved before a series existed its default, and keeps what was saved', () => {
		const saved = {
			...DEFAULT_DOCUMENT_NUMBERING,
			series: { taxInvoice: { ...DEFAULT_SERIES.taxInvoice, prefix: 'INV' } },
		};
		const parsed = DocumentNumberingSettings.parse(saved);
		expect(parsed.series.pettyExpense.prefix).toBe('PC');
		expect(parsed.series.expenseClaim.prefix).toBe('EC');
		expect(parsed.series.taxInvoice.prefix).toBe('INV');
		expect(
			DocumentNumberingSettings.parse({ ...DEFAULT_DOCUMENT_NUMBERING, series: undefined }).series.receipt.prefix,
		).toBe('RC');
	});
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { accountsRefusal } from '../src/ledger/accounts-refusal';

/** What the filter puts on the wire for an accounts refusal. */
function render(exception: unknown) {
	let body: { error: { issues: unknown[]; message: string } } = { error: { issues: [], message: '' } };
	const reply = {
		status: () => reply,
		header: () => reply,
		send: (sent: typeof body) => ((body = sent), reply),
	};
	const host = {
		switchToHttp: () => ({ getRequest: () => ({ id: 'req_1' }), getResponse: () => reply }),
	} as unknown as ArgumentsHost;
	new HttpExceptionFilter().catch(exception, host);
	return body.error;
}

describe('accounts refusals reach the admin', () => {
	it('carries the code as the issue, so the screen can say it in words', () => {
		const error = new ConflictException(accountsRefusal('refund_after_invoice_needs_credit_note'));
		expect(error.message).toBe('refund_after_invoice_needs_credit_note');
		expect(render(error).issues).toEqual([
			{
				path: ['request'],
				message: 'refund_after_invoice_needs_credit_note',
				code: 'refund_after_invoice_needs_credit_note',
			},
		]);
		// Before: a bare code was replaced by the filter's safe sentence and the screen could only say "failed".
		expect(render(new BadRequestException('invoice_problem:no_hsn:BAN-3')).issues).toEqual([]);
	});
});

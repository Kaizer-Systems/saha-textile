import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import { apiIssues, apiProblem } from './purchasing-format';

describe('API refusals on the purchases screens', () => {
	it('reads the sentence from the envelope the API sends (`{ error: { issues } }`)', () => {
		const stale = new HttpErrorResponse({
			status: 409,
			error: {
				error: {
					code: 'validation_failed',
					message: 'Request validation failed.',
					issues: [
						{
							path: ['stale_version'],
							message: 'Changed by Rina at 4:02 pm. Reload to see it.',
							code: 'stale_version',
						},
					],
				},
			},
		});
		expect(apiProblem(stale, 'fallback')).toBe('Changed by Rina at 4:02 pm. Reload to see it.');
		expect(apiIssues(stale)).toEqual([
			{ code: 'stale_version', message: 'Changed by Rina at 4:02 pm. Reload to see it.', target: null },
		]);
	});

	it('names what a refusal is about from the second part of its path', () => {
		const refused = new HttpErrorResponse({
			status: 400,
			error: {
				error: {
					code: 'validation_failed',
					message: 'x',
					issues: [
						{
							path: ['gstin_check_digit', 'gstin'],
							message: 'Should end in M.',
							code: 'gstin_check_digit',
						},
					],
				},
			},
		});
		expect(apiIssues(refused)[0]).toEqual({
			code: 'gstin_check_digit',
			message: 'Should end in M.',
			target: 'gstin',
		});
	});

	it('still reads a bare body, the envelope message alone, and gives nothing for a network failure', () => {
		const bare = new HttpErrorResponse({
			status: 400,
			error: { issues: [{ code: 'no_lines', message: 'Add a line.' }] },
		});
		expect(apiProblem(bare, 'fallback')).toBe('Add a line.');
		const messageOnly = new HttpErrorResponse({
			status: 403,
			error: { error: { code: 'forbidden', message: 'Not allowed.' } },
		});
		expect(apiProblem(messageOnly, 'fallback')).toBe('Not allowed.');
		expect(apiIssues(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }))).toEqual([]);
		expect(apiProblem(null, 'fallback')).toBe('fallback');
	});
});

import { describe, expect, it } from 'vitest';

import { hostedState, merchantApiState, refundState } from '../src/ccavenue/ccavenue-status-map';

describe('hostedState', () => {
	it.each([
		['Success', 'authorized'],
		['Failure', 'failed'],
		['Aborted', 'cancelled'],
		['Invalid', 'failed'],
		['Timeout', 'failed'],
	])('maps %s to %s', (status, state) => {
		expect(hostedState(status)).toBe(state);
	});

	it.each(['Successful', 'success', '', 'constructor'])('never reads %j as paid', (status) => {
		expect(hostedState(status)).toBe('review');
	});
});

describe('merchantApiState', () => {
	it.each([
		['Initiated', 'pending'],
		['Awaited', 'pending'],
		['Successful', 'authorized'],
		['Shipped', 'captured'],
		['Aborted', 'cancelled'],
		['Cancelled', 'cancelled'],
		['Auto-Cancelled', 'cancelled'],
		['Unsuccessful', 'failed'],
		['Invalid', 'failed'],
		['Timeout', 'failed'],
		['Refunded', 'refunded'],
		['Systemrefund', 'refunded'],
		['Auto-Reversed', 'refunded'],
		['Fraud', 'review'],
		['Chargeback', 'review'],
	])('maps %s to %s', (status, state) => {
		expect(merchantApiState(status, 'NA')).toBe(state);
	});

	it.each(['Success', 'successful', '', '__proto__'])('never reads %j as paid', (status) => {
		expect(merchantApiState(status, undefined)).toBe('review');
	});

	it('holds a high fraud rating for an operator', () => {
		expect(merchantApiState('Successful', 'High')).toBe('review');
		expect(merchantApiState('Successful', 'Low')).toBe('authorized');
	});
});

describe('refundState', () => {
	it.each([
		['TS-REFC', 'completed'],
		['TS-REFA', 'pending'],
		['TS-REFF', 'failed'],
		['TS-REFD', 'declined'],
		['TS-NEW', 'review'],
	])('maps %s to %s', (status, state) => {
		expect(refundState(status)).toBe(state);
	});
});

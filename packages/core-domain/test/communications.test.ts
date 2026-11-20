import type {
	CommunicationCell,
	CommunicationChannel,
	CommunicationSwitch,
	CommunicationUse,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	CommunicationSendGate,
	type CommunicationSwitchRepository,
	communicationCellOn,
	communicationGroupForTemplate,
	communicationUseForTemplate,
	decideCommunicationChange,
	isCommunicationCellLocked,
} from '../src/index';

/**
 * Rows shaped like the approved list in contracts. Core may import only types from contracts, so
 * the real list is exercised by the API's communications test instead.
 */
const ON: CommunicationCell = { available: true, on: true, risk: 'none' };
const warning: CommunicationCell = { available: true, on: false, risk: 'warning', reasonKey: 'r' };
const danger: CommunicationCell = { available: true, on: false, risk: 'danger', reasonKey: 'r' };
const unavailable: CommunicationCell = { available: false, on: false, risk: 'none', reasonKey: 'r' };
const COMMUNICATION_USES: CommunicationUse[] = [
	{ key: 'signup_code', group: 'account', cells: { email: ON, sms: ON, whatsapp: ON } },
	{ key: 'signin_code', group: 'account', cells: { email: ON, sms: ON, whatsapp: ON } },
	{ key: 'password_reset', group: 'account', cells: { email: ON, sms: warning, whatsapp: warning } },
	{ key: 'email_verification', group: 'account', cells: { email: ON, sms: danger, whatsapp: danger } },
	{ key: 'staff_invitation', group: 'account', cells: { email: ON, sms: danger, whatsapp: danger } },
	{ key: 'order_shipped', group: 'orders', cells: { email: ON, sms: ON, whatsapp: ON } },
	{ key: 'newsletter', group: 'marketing', cells: { email: ON, sms: unavailable, whatsapp: unavailable } },
	{ key: 'back_in_stock', group: 'shop', cells: { email: ON, sms: ON, whatsapp: ON } },
	{ key: 'sale_launch_announcement', group: 'marketing', cells: { email: ON, sms: warning, whatsapp: warning } },
];

const use = (key: string) => {
	const found = COMMUNICATION_USES.find((row) => row.key === key);
	if (!found) throw new Error(key);
	return found;
};
const allOn = () => true;
const decide = (
	key: string,
	channel: CommunicationChannel,
	on: boolean,
	current: (channel: CommunicationChannel) => boolean = allOn,
) => decideCommunicationChange(COMMUNICATION_USES, { use: key, channel, on }, current);

describe('communication cells', () => {
	it('starts from the recommended state when nothing is stored', () => {
		expect(communicationCellOn(use('signin_code'), 'sms', null)).toBe(true);
		expect(communicationCellOn(use('password_reset'), 'sms', null)).toBe(false);
	});

	it('follows a stored row, except that red and unavailable cells stay off', () => {
		expect(communicationCellOn(use('password_reset'), 'sms', { on: true })).toBe(true);
		expect(communicationCellOn(use('order_shipped'), 'email', { on: false })).toBe(false);
		expect(communicationCellOn(use('email_verification'), 'sms', { on: true })).toBe(false);
		expect(communicationCellOn(use('newsletter'), 'whatsapp', { on: true })).toBe(false);
		expect(isCommunicationCellLocked(use('staff_invitation'), 'whatsapp')).toBe(true);
		expect(isCommunicationCellLocked(use('staff_invitation'), 'email')).toBe(false);
	});

	it('maps every sent template to its message', () => {
		expect(communicationUseForTemplate('otp_login')).toBe('signin_code');
		expect(communicationUseForTemplate('shop_event_announcement')).toBe('sale_launch_announcement');
		expect(communicationUseForTemplate('something_else')).toBeNull();
		expect(communicationUseForTemplate('order_payment_link')).toBe('payment_request');
		expect(communicationUseForTemplate('payment_not_completed')).toBe('payment_failed');
	});

	it('puts every sent template in its group, and anything else in account', () => {
		expect(communicationGroupForTemplate('otp_login', COMMUNICATION_USES)).toBe('account');
		expect(communicationGroupForTemplate('back_in_stock', COMMUNICATION_USES)).toBe('shop');
		expect(communicationGroupForTemplate('shop_event_announcement', COMMUNICATION_USES)).toBe('marketing');
		expect(communicationGroupForTemplate('something_else', COMMUNICATION_USES)).toBe('account');
		expect(communicationGroupForTemplate('back_in_stock', [])).toBe('account');
	});
});

describe('deciding a change', () => {
	it('asks for the password only when a yellow cell goes on', () => {
		expect(decide('password_reset', 'sms', true, () => false)).toEqual({
			ok: true,
			from: false,
			needsPassword: true,
		});
		expect(decide('password_reset', 'sms', false)).toEqual({ ok: true, from: true, needsPassword: false });
		expect(decide('order_shipped', 'sms', true, () => false)).toEqual({
			ok: true,
			from: false,
			needsPassword: false,
		});
		// Already on: saving it on again costs nothing.
		expect(decide('password_reset', 'sms', true)).toEqual({ ok: true, from: true, needsPassword: false });
	});

	it('refuses red, unavailable and unknown cells', () => {
		expect(decide('email_verification', 'sms', true)).toEqual({ ok: false, reason: 'locked' });
		expect(decide('newsletter', 'sms', true)).toEqual({ ok: false, reason: 'unavailable' });
		expect(decide('no_such_message', 'email', true)).toEqual({ ok: false, reason: 'unknown_use' });
	});

	it('keeps email on and one phone channel on for the code rows', () => {
		expect(decide('signin_code', 'email', false)).toEqual({ ok: false, reason: 'email_required' });
		expect(decide('signup_code', 'sms', false)).toEqual({ ok: true, from: true, needsPassword: false });
		const whatsappOff = (channel: CommunicationChannel) => channel !== 'whatsapp';
		expect(decide('signup_code', 'sms', false, whatsappOff)).toEqual({
			ok: false,
			reason: 'phone_channel_required',
		});
		// Other rows may lose email.
		expect(decide('order_shipped', 'email', false).ok).toBe(true);
	});
});

describe('the send gate', () => {
	const stored: CommunicationSwitch[] = [
		{ use: 'signin_code', channel: 'whatsapp', on: false, updatedBy: 'u1', updatedAt: '2026-11-14T00:00:00Z' },
	];
	const repository: CommunicationSwitchRepository = {
		list: async () => stored,
		find: async (key, channel) => stored.find((row) => row.use === key && row.channel === channel) ?? null,
		save: async (entry) => entry,
	};
	const gate = new CommunicationSendGate(COMMUNICATION_USES, repository);

	it('stops a message whose cell is off and lets the rest through', async () => {
		expect(await gate.allows('otp_login', 'whatsapp')).toBe(false);
		expect(await gate.allows('otp_login', 'sms')).toBe(true);
		expect(await gate.allows('verify_email', 'sms')).toBe(false);
		expect(await gate.allows('an_unlisted_template', 'sms')).toBe(true);
	});
});

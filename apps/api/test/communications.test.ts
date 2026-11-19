import 'reflect-metadata';

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditLog, CommunicationSwitch } from '@saha-textile/contracts';
import type { AuditLogRepository, CommunicationSwitchRepository } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSecurityService } from '../src/auth/admin-security.service';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CommunicationsController } from '../src/communications/communications.controller';
import { CommunicationsService } from '../src/communications/communications.service';
import { ConsoleNotificationAdapter } from '../src/infra/console-notification.adapter';

/** In-memory switches and audit, and a password check that knows one password. */
function setup(initial: CommunicationSwitch[] = []) {
	const rows = new Map(initial.map((row) => [`${row.use}.${row.channel}`, row]));
	const switches: CommunicationSwitchRepository = {
		list: async () => [...rows.values()],
		find: async (use, channel) => rows.get(`${use}.${channel}`) ?? null,
		save: async (entry) => {
			const saved = { ...entry, updatedAt: '2026-11-14T00:00:00.000Z' };
			rows.set(`${entry.use}.${entry.channel}`, saved);
			return saved;
		},
	};
	const audits: AuditLog[] = [];
	const audit = { append: async (entry: AuditLog) => (audits.push(entry), entry) } as unknown as AuditLogRepository;
	const confirmCurrentPassword = vi.fn(async (_userId: string, password: string) => {
		if (password !== 'right-password') throw new ForbiddenException('Invalid credentials');
	});
	const security = { confirmCurrentPassword } as unknown as AdminSecurityService;
	return { service: new CommunicationsService(switches, audit, security), rows, audits, confirmCurrentPassword };
}

/** The rule code a refused change carries (`domainRefusal`). */
const refusalOf = async (attempt: Promise<unknown>): Promise<string | undefined> => {
	const error = await attempt.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(BadRequestException);
	return ((error as BadRequestException).getResponse() as { issues: { code: string }[] }).issues[0]?.code;
};

const cellOf = async (service: CommunicationsService, use: string, channel: 'email' | 'sms' | 'whatsapp') =>
	(await service.view()).items.find((row) => row.key === use)?.cells[channel];

describe('Settings › Communications service', () => {
	it('serves the approved list in its recommended state when nothing is stored', async () => {
		const { service } = setup();
		const view = await service.view();
		expect(view.items).toHaveLength(22);
		expect(view.channels).toEqual(['email', 'sms', 'whatsapp']);
		expect(await cellOf(service, 'password_reset', 'sms')).toMatchObject({
			on: false,
			recommended: false,
			risk: 'warning',
			locked: false,
		});
		expect(await cellOf(service, 'email_verification', 'whatsapp')).toMatchObject({ on: false, locked: true });
	});

	it('turns a yellow cell on only with the right password, and audits it', async () => {
		const { service, audits, rows, confirmCurrentPassword } = setup();
		const change = { use: 'password_reset', channel: 'sms' as const, on: true };
		await expect(service.change('admin_1', change, null)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.change('admin_1', { ...change, currentPassword: 'wrong' }, null)).rejects.toThrow(
			'Invalid credentials',
		);
		expect(rows.size).toBe(0);
		expect(audits).toHaveLength(0);

		await service.change('admin_1', { ...change, currentPassword: 'right-password' }, 'req_1');
		expect(confirmCurrentPassword).toHaveBeenLastCalledWith('admin_1', 'right-password');
		expect(await cellOf(service, 'password_reset', 'sms')).toMatchObject({ on: true });
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: 'communication.switch.change',
			actorUserId: 'admin_1',
			entityId: 'password_reset.sms',
			diffs: [{ field: 'on', before: false, after: true }],
			metadata: { use: 'password_reset', channel: 'sms', passwordConfirmed: true },
			requestId: 'req_1',
		});
		expect(JSON.stringify(audits[0])).not.toContain('right-password');
	});

	it('turns cells off, and plain cells on, without a password', async () => {
		const { service, confirmCurrentPassword } = setup();
		await service.change('admin_1', { use: 'order_shipped', channel: 'sms', on: false }, null);
		await service.change('admin_1', { use: 'order_shipped', channel: 'sms', on: true }, null);
		expect(confirmCurrentPassword).not.toHaveBeenCalled();
		expect(await cellOf(service, 'order_shipped', 'sms')).toMatchObject({ on: true });
	});

	it('records nothing when a cell already has the asked state', async () => {
		const { service, audits, rows } = setup();
		await service.change('admin_1', { use: 'order_shipped', channel: 'email', on: true }, null);
		expect(rows.size).toBe(0);
		expect(audits).toHaveLength(0);
	});

	it('refuses red cells even with the password, unavailable cells and unknown messages', async () => {
		const { service } = setup();
		const red = { use: 'staff_invitation', channel: 'sms' as const, on: true, currentPassword: 'right-password' };
		expect(await refusalOf(service.change('admin_1', red, null))).toBe('locked');
		expect(
			await refusalOf(service.change('admin_1', { use: 'newsletter', channel: 'whatsapp', on: true }, null)),
		).toBe('unavailable');
		await expect(
			service.change('admin_1', { use: 'no_such_message', channel: 'email', on: true }, null),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('keeps email and one phone channel on for the code rows', async () => {
		const { service } = setup();
		expect(
			await refusalOf(service.change('admin_1', { use: 'signin_code', channel: 'email', on: false }, null)),
		).toBe('email_required');
		await service.change('admin_1', { use: 'signin_code', channel: 'whatsapp', on: false }, null);
		expect(
			await refusalOf(service.change('admin_1', { use: 'signin_code', channel: 'sms', on: false }, null)),
		).toBe('phone_channel_required');
	});
});

describe('Settings › Communications routes — declared permissions', () => {
	const requiredFor = (method: keyof CommunicationsController): string[] | undefined =>
		Reflect.getMetadata(PERMISSIONS_KEY, CommunicationsController.prototype[method]);

	it('reads with setting.index and changes with setting.edit', () => {
		expect(requiredFor('view')).toEqual(['setting.index']);
		expect(requiredFor('change')).toEqual(['setting.edit']);
	});
});

describe('the console sender obeys the switches', () => {
	const message = {
		channel: 'whatsapp' as const,
		category: 'transactional' as const,
		templateKey: 'otp_login',
		destination: '+919800000000',
	};

	it('suppresses a message switched off and sends the rest', async () => {
		const allows = vi.fn(async (templateKey: string) => templateKey !== 'otp_login');
		const port = new ConsoleNotificationAdapter({ allows });
		expect((await port.send(message)).status).toBe('suppressed_use_disabled');
		expect((await port.send({ ...message, templateKey: 'order_shipped' })).status).toBe('sent');
		expect(allows).toHaveBeenCalledWith('otp_login', 'whatsapp');
	});
});

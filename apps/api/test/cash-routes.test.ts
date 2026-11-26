import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CashController } from '../src/cash/cash.controller';
import { CashModule } from '../src/cash/cash.module';
import { CashService } from '../src/cash/cash.service';

/** Cash routes (accounts brief O): each passes what it was sent and who sent it, behind its permission. */

const principal = { userId: 'adm_meera' } as never;

describe('cash routes', () => {
	it('passes each route to its service with who is acting', async () => {
		const calls: [string, unknown[]][] = [];
		const record =
			(name: string) =>
			async (...args: unknown[]) => {
				calls.push([name, args]);
				return name === 'releaseSuspense' ? 2 : name;
			};
		const service = (names: string[]) => Object.fromEntries(names.map((n) => [n, record(n)]));
		const controller = new CashController(
			service([
				'settingsView',
				'saveSettings',
				'choices',
				'today',
				'list',
				'open',
				'view',
				'count',
				'submitDifference',
				'move',
				'settle',
				'releaseSuspense',
			]) as never,
			service(['check', 'list', 'pay', 'refillPreview', 'refill']) as never,
			service(['list', 'create', 'get', 'decide']) as never,
		);
		const body = { any: true } as never;
		expect(await controller.settings()).toBe('settingsView');
		await controller.saveSettings(body, principal);
		await controller.saveSettings(body);
		await controller.choices(principal);
		await controller.today({ boxId: 'box_1' }, principal);
		await controller.list(body, principal);
		await controller.open(body, principal);
		await controller.view('sh_1', principal);
		await controller.count('sh_1', body, principal);
		await controller.submitDifference('sh_1', body, principal);
		await controller.move('sh_1', body, principal);
		await controller.settle('sh_1', body, principal);
		expect(await controller.releaseSuspense()).toEqual({ released: 2 });
		await controller.checkPetty({ boxId: 'box_1', paidTo: 'x', amountPaise: 5 }, principal);
		await controller.listPetty(body, principal);
		await controller.pay(body, principal);
		await controller.refillPreview('box_1', principal);
		await controller.refill('box_1', body, principal);
		await controller.listClaims(body, principal);
		await controller.createClaim(body, principal);
		await controller.getClaim('ec_1', principal);
		await controller.decide('ec_1', body, principal);
		expect(calls.find(([name]) => name === 'saveSettings')?.[1]).toEqual([body, 'adm_meera']);
		expect(calls.filter(([name]) => name === 'saveSettings')[1]?.[1]).toEqual([body, null]);
		expect(calls.find(([name]) => name === 'today')?.[1]).toEqual(['box_1', principal]);
		expect(calls.find(([name]) => name === 'check')?.[1]).toEqual(['box_1', 'x', 5, principal]);
		expect(calls).toHaveLength(22);
	});

	it('guards settings, counting, managing and claims with their own permissions', () => {
		const reflector = new Reflector();
		const guard = (method: keyof CashController) =>
			reflector.get<string[]>(PERMISSIONS_KEY, CashController.prototype[method] as never);
		expect(guard('saveSettings')).toEqual(['cash.settings']);
		expect(guard('count')).toEqual(['cash.count']);
		expect(guard('settle')).toEqual(['cash.manage']);
		expect(guard('createClaim')).toEqual(['expense_claim.create']);
		expect(guard('view')).toEqual(['cash.index']);
	});

	it('wires cash into the API', () => {
		expect(Reflect.getMetadata('providers', CashModule)).toContain(CashService);
		expect(Reflect.getMetadata('controllers', CashModule)).toEqual([CashController]);
	});
});

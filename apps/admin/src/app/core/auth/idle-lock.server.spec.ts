// @vitest-environment node
import { Injector, runInInjectionContext } from '@angular/core';

import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { AdminAuthGateway } from './auth-gateway';
import { IdleLockService } from './idle-lock.service';

describe('IdleLockService on the server', () => {
	it('never touches a window', () => {
		const injector = Injector.create({
			providers: [
				{ provide: AuthStore, useValue: { isAuthenticated: () => true } },
				{ provide: AdminAuthGateway, useValue: {} },
			],
		});
		const service = runInInjectionContext(injector, () => new IdleLockService());
		const interval = vi.spyOn(globalThis, 'setInterval');
		service.start();
		service.stop();
		expect(interval).not.toHaveBeenCalled();
	});
});

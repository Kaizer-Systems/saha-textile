import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { AuthStore } from '@core/state/auth.store';

import { Login } from './login';

vi.mock('@core/brand/brand.gateway', () => ({ injectBrandQuery: () => ({ data: () => undefined }) }));

describe('the sign-in page drawn on the server', () => {
	it('never asks about a key-leak sign-out', () => {
		const sessionNotice = vi.fn(() => of('2026-11-23'));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PLATFORM_ID, useValue: 'server' },
				{ provide: AuthStore, useValue: { error: signal(null), pending: signal(false), clearError: vi.fn() } },
				{ provide: Router, useValue: { navigateByUrl: vi.fn(), navigate: vi.fn() } },
				{ provide: AdminAuthGateway, useValue: { sessionNotice } },
				{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
			],
		});
		TestBed.overrideComponent(Login, { set: { imports: [], template: '' } });
		const login = TestBed.createComponent(Login).componentInstance;
		expect(sessionNotice).not.toHaveBeenCalled();
		expect(login.signedOutDay()).toBeNull();
	});
});

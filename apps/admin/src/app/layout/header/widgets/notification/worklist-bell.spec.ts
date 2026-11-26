import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NavService } from '@data-access/services/nav.service';

import { Notification } from './notification';

/** The worklist's line in the bell (brief 26 WL1): how many items wait on the signed-in person, opening the Worklist. */

const { worklist } = vi.hoisted(() => ({ worklist: { data: undefined as { count: number } | undefined } }));
vi.mock('@core/worklist/worklist.gateway', () => ({
	injectWorklistCountQuery: () => ({ data: () => worklist.data }),
}));
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: () => undefined }),
}));
vi.mock('@data-access/queries/admin-languages.queries', () => ({
	injectLanguageRemindersQuery: () => ({ data: () => undefined }),
}));
vi.mock('@data-access/queries/media-library.queries', () => ({
	injectMediaStorageQuery: () => ({ data: () => undefined }),
	injectNightlyCheckQuery: () => ({ data: () => undefined }),
}));
vi.mock('@data-access/queries/page-builder.queries', () => ({
	injectPageBuilderAlertsQuery: () => ({ data: () => undefined }),
}));
vi.mock('@core/purchasing/stock.gateway', async (original) => ({
	...(await original<object>()),
	injectStockAlertsQuery: () => ({ data: () => undefined }),
}));

function bell(count: number | undefined) {
	worklist.data = count === undefined ? undefined : { count };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			Notification,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			{ provide: NavService, useValue: {} },
			{ provide: AuthStore, useValue: { permissions: signal([]) } },
			{ provide: StockGateway, useValue: { markSeen: vi.fn() } },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(() => Promise.resolve()) } },
		],
	});
	const fixture = TestBed.createComponent(Notification);
	fixture.detectChanges();
	return { fixture, widget: fixture.componentInstance };
}

describe('the worklist’s line in the bell (WL1)', () => {
	it('counts the worklist as one unread line and opens the Worklist from it', () => {
		const { fixture, widget } = bell(4);
		expect([widget.worklist(), widget.unreadNotificationCount()]).toEqual([4, 1]);
		expect(fixture.nativeElement.querySelector('.badge')?.textContent?.trim()).toBe('1');
		const line = fixture.nativeElement.querySelector('#worklist_bell') as HTMLAnchorElement;
		expect([line.getAttribute('href'), line.textContent?.trim()]).toEqual(['/worklist', 'wl_bell']);
		expect(fixture.nativeElement.querySelector('.notification-dropdown')).not.toBeNull();
	});

	it('shows no line, badge or list when nothing waits, or before the count is read', () => {
		for (const count of [0, undefined]) {
			const { fixture, widget } = bell(count);
			expect([widget.worklist(), widget.unreadNotificationCount()]).toEqual([0, 0]);
			expect(fixture.nativeElement.querySelector('#worklist_bell')).toBeNull();
			expect(fixture.nativeElement.querySelector('.notification-dropdown')).toBeNull();
			expect(fixture.nativeElement.querySelector('.badge')).toBeNull();
		}
	});
});

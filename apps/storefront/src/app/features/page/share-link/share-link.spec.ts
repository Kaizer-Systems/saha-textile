import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareLinkService, type ShareOpenAnswer } from '@data-access/services/share-link.service';

import { DOWNLOAD_SETTLE_MS, OPENING_DELAY_MS, OPEN_ADDRESS, ShareLink } from './share-link';

const OPEN: ShareOpenAnswer = {
	state: 'open',
	url: 'https://spaces.test/media/med_1/original.zip?signed',
	fileName: 'bridal-catalogue-2027.zip',
	contentType: 'application/zip',
	bytes: 19_503_513,
};

/** The page with the API's answers queued and the browser's hand-over recorded. */
function render(checks: Array<ShareOpenAnswer | Promise<ShareOpenAnswer>>, posts: ShareOpenAnswer[] = []) {
	const shares = {
		check: vi.fn(async () => (checks.length > 1 ? checks.shift() : checks[0]) as ShareOpenAnswer),
		openWithPassword: vi.fn(async () => posts.shift() as ShareOpenAnswer),
	};
	const openAddress = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ShareLinkService, useValue: shares },
			{ provide: OPEN_ADDRESS, useValue: openAddress },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: new Map([['code', 'k7Q2mX9vT3abcdefghijkl']]) } },
			},
			{
				provide: TranslocoService,
				useValue: { selectTranslate: () => of('Shared file'), getActiveLang: () => 'en' },
			},
		],
	});
	TestBed.overrideComponent(ShareLink, { set: { imports: [], template: '' } });
	const view = TestBed.createComponent(ShareLink).componentInstance;
	return { view, shares, openAddress };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the share link page', () => {
	it('sends the browser to the file at once and never flashes “Opening the file…” for a quick answer', async () => {
		const { view, shares, openAddress } = render([OPEN]);
		await settle();
		expect(shares.check).toHaveBeenCalledWith('k7Q2mX9vT3abcdefghijkl');
		expect(openAddress).toHaveBeenCalledWith(OPEN.url);
		expect(view.view()).toBe('opening');
		// The browser showed the file (S7): this page is left, so it never claims a download.
		dispatchEvent(new Event('pagehide'));
		await vi.advanceTimersByTimeAsync(DOWNLOAD_SETTLE_MS);
		expect(view.view()).toBe('opening');
	});

	it('shows “Opening the file…” only after 0.3 s of waiting', async () => {
		let answer: (value: ShareOpenAnswer) => void = () => undefined;
		const { view } = render([new Promise<ShareOpenAnswer>((resolve) => (answer = resolve))]);
		await vi.advanceTimersByTimeAsync(OPENING_DELAY_MS - 1);
		expect(view.view()).toBe('waiting');
		await vi.advanceTimersByTimeAsync(1);
		expect(view.view()).toBe('opening');
		answer({ state: 'admins_only' });
		await settle();
		expect(view.view()).toBe('staff');
	});

	it('says the download started when the browser saved the file, and starts it again on request', async () => {
		const { view, shares, openAddress } = render([OPEN]);
		await vi.advanceTimersByTimeAsync(DOWNLOAD_SETTLE_MS);
		expect(view.view()).toBe('downloading');
		expect(view.file()).toEqual({ name: 'bridal-catalogue-2027.zip', bytes: OPEN.bytes });
		expect(view.fileSize()).toBe('18.6 MB');
		await view.downloadAgain();
		expect(shares.check).toHaveBeenCalledTimes(2);
		expect(openAddress).toHaveBeenCalledTimes(2);
		expect(view.view()).toBe('downloading');
	});

	it('asks for the password, says when it was wrong, and opens with the right one', async () => {
		const { view, shares, openAddress } = render(
			[{ state: 'password', wrong: false }],
			[{ state: 'password', wrong: true }, OPEN, OPEN],
		);
		await settle();
		expect(view.view()).toBe('password');
		view.password = 'nope';
		await view.submit();
		expect(view.wrong()).toBe(true);
		view.password = 'tant-2027';
		await view.submit();
		expect(shares.openWithPassword).toHaveBeenLastCalledWith('k7Q2mX9vT3abcdefghijkl', 'tant-2027');
		expect(openAddress).toHaveBeenCalledWith(OPEN.url);
		// “Click here to download it” on a password link sends the accepted password again.
		await vi.advanceTimersByTimeAsync(DOWNLOAD_SETTLE_MS);
		await view.downloadAgain();
		expect(shares.openWithPassword).toHaveBeenLastCalledWith('k7Q2mX9vT3abcdefghijkl', 'tant-2027');
		expect(shares.check).toHaveBeenCalledTimes(1);
	});

	it('locks the password box after too many tries, and never sends an empty password', async () => {
		const { view, shares } = render([{ state: 'password' }], [{ state: 'too_many' }]);
		await settle();
		await view.submit();
		expect(shares.openWithPassword).not.toHaveBeenCalled();
		view.password = 'guess';
		await view.submit();
		expect(view.view()).toBe('too_many');
	});

	it('shows the expired page for dead links, failed requests, and a limit hit before any password', async () => {
		expect(
			await (async () => {
				const { view } = render([{ state: 'expired' }]);
				await settle();
				return view.view();
			})(),
		).toBe('expired');
		const { view } = render([{ state: 'too_many' }]);
		await settle();
		expect(view.view()).toBe('expired');
		const failing = render([Promise.reject(new Error('offline'))]);
		await settle();
		expect(failing.view.view()).toBe('expired');
	});
});

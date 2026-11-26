import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';

import { YouTubeVideosField, videoLength } from './youtube-videos-field';

import type { ProductVideo } from '@saha-textile/contracts';

const video = (videoId: string, kind: 'video' | 'short' = 'video'): ProductVideo => ({
	videoId,
	title: `Title ${videoId}`,
	thumbnailUrl: 'u',
	kind,
	durationSeconds: kind === 'short' ? 48 : 1521,
});

const render = (rows: ProductVideo[] = []) => {
	const gateway = { validate: vi.fn((input: string) => of(video(input))) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: YouTubeGateway, useValue: gateway },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(YouTubeVideosField, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(YouTubeVideosField);
	const control = new FormControl<ProductVideo[]>(rows, { nonNullable: true });
	fixture.componentRef.setInput('control', control);
	return { field: fixture.componentInstance, gateway, control };
};

const paste = (text: string) => {
	const event = { clipboardData: { getData: () => text }, preventDefault: vi.fn() };
	return event as unknown as ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
};

describe('videoLength', () => {
	it.each([
		[48, '0:48'],
		[1521, '25:21'],
		[3723, '1:02:03'],
	])('writes %i seconds as %s', (seconds, text) => expect(videoLength(seconds)).toBe(text));
});

describe('YouTubeVideosField', () => {
	it('checks a pasted link at once and adds what the API answered', async () => {
		const { field, gateway, control } = render();
		const event = paste('https://youtu.be/aaaaaaaaaaa');
		field.pasted(event);
		await vi.waitFor(() => expect(control.value).toHaveLength(1));
		expect(event.preventDefault).toHaveBeenCalled();
		expect(gateway.validate).toHaveBeenCalledWith('https://youtu.be/aaaaaaaaaaa');
		expect(field.text()).toBe('');
		expect(field.adding()).toBe(false);
		expect(control.dirty).toBe(true);
	});

	it('ignores an empty paste and an empty box', async () => {
		const { field, gateway } = render();
		const event = paste('  ');
		field.pasted(event);
		await field.validate();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(gateway.validate).not.toHaveBeenCalled();
	});

	it('refuses the same video twice', async () => {
		const { field, control } = render([video('aaaaaaaaaaa')]);
		field.edit('aaaaaaaaaaa');
		await field.validate();
		expect(control.value).toHaveLength(1);
		expect(field.error()).toBe('product_video_already_added');
	});

	it('stops at five', async () => {
		const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
		const { field, control } = render(ids.map((id) => video(id)));
		field.edit('fffffffffff');
		await field.validate();
		expect(control.value).toHaveLength(5);
	});

	it('shows the API refusal, or a general message', async () => {
		const { field, gateway, control } = render();
		field.edit('private-one');
		gateway.validate.mockReturnValueOnce(
			throwError(() => ({ error: { message: 'No public, embeddable video has that id.' } })),
		);
		await field.validate();
		expect(field.error()).toBe('No public, embeddable video has that id.');
		gateway.validate.mockReturnValueOnce(throwError(() => new Error('down')));
		await field.validate();
		expect(field.error()).toBe('product_video_check_failed');
		expect(field.checking()).toBe(false);
		expect(control.value).toEqual([]);
		field.edit('x');
		expect(field.error()).toBeNull();
	});

	it('moves and removes rows, and keeps a move inside the list', () => {
		const { field, control } = render([video('aaaaaaaaaaa'), video('bbbbbbbbbbb', 'short')]);
		field.move(1, -1);
		expect(control.value.map((row) => row.videoId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
		field.move(5, 1);
		expect(control.value).toHaveLength(2);
		field.remove(0);
		expect(control.value.map((row) => row.videoId)).toEqual(['aaaaaaaaaaa']);
	});
});

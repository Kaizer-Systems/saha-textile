import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { FileSizePipe } from './language.pipes';

describe('fileSize', () => {
	it('writes a size in the admin language, and nothing known as 0', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [FileSizePipe, { provide: TranslocoService, useValue: { getActiveLang: () => 'en' } }],
		});
		const pipe = TestBed.inject(FileSizePipe);
		expect(pipe.transform(19_503_513)).toMatch(/18\.6\s?MB/);
		expect(pipe.transform(null)).toBe(pipe.transform(0));
		expect(pipe.transform(undefined)).toBe(pipe.transform(0));
	});
});

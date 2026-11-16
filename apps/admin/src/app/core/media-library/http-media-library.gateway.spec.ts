import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import { HttpMediaLibraryGateway } from './http-media-library.gateway';
import { MediaLibraryGateway } from './media-library.gateway';

/** Pins each Media page call to its route, method and body, and keeps changes quiet. */
describe('HttpMediaLibraryGateway', () => {
	let gateway: MediaLibraryGateway;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: MediaLibraryGateway, useClass: HttpMediaLibraryGateway },
			],
		});
		gateway = TestBed.inject(MediaLibraryGateway);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	const expectCall = (method: string, path: RegExp, body?: unknown, quiet = true) => {
		const request = http.expectOne(() => true);
		expect(request.request.method).toBe(method);
		expect(request.request.urlWithParams).toMatch(path);
		if (body !== undefined) expect(request.request.body).toEqual(body);
		expect(request.request.context.get(QUIET_ERRORS)).toBe(quiet);
		request.flush({});
	};

	it('browses with only the parts of the view that are set', () => {
		gateway.browse({ view: 'folder', folderId: 'fld_1', search: '', page: 2, category: undefined }).subscribe();
		expectCall('GET', /\/admin\/media\/library\?view=folder&folderId=fld_1&page=2$/, undefined, false);
		gateway.tree().subscribe();
		expectCall('GET', /\/admin\/media\/library\/tree$/, undefined, false);
		gateway.activity(3).subscribe();
		expectCall('GET', /\/admin\/media\/library\/activity\?page=3$/, undefined, false);
	});

	it('makes folder and file changes on their own routes', () => {
		gateway.createFolder({ name: 'Bridal 2027', parentId: null }).subscribe();
		expectCall('POST', /\/folders$/, { name: 'Bridal 2027', parentId: null });
		gateway.renameFolder('fld/1', 'Wedding').subscribe();
		expectCall('PATCH', /\/folders\/fld%2F1$/, { name: 'Wedding' });
		gateway.renameFile('med_1', 'front.jpg').subscribe();
		expectCall('PATCH', /\/files\/med_1$/, { name: 'front.jpg' });
		gateway.move({ fileIds: ['med_1'], folderIds: [], toFolderId: 'fld_2' }).subscribe();
		expectCall('POST', /\/move$/, { fileIds: ['med_1'], folderIds: [], toFolderId: 'fld_2' });
		gateway.checkTrash({ fileIds: ['med_1'], folderIds: ['fld_1'] }).subscribe();
		expectCall('POST', /\/trash\/check$/, { fileIds: ['med_1'], folderIds: ['fld_1'] });
		gateway.trash({ fileIds: ['med_1'], folderIds: [] }).subscribe();
		expectCall('POST', /\/trash$/);
		gateway.restore({ fileIds: ['med_1'], folderIds: [], whenFolderGone: 'my_files' }).subscribe();
		expectCall('POST', /\/restore$/);
		gateway.deleteForever({ fileIds: ['med_1'], folderIds: [] }).subscribe();
		expectCall('POST', /\/delete-forever$/);
		gateway.undo('audit_1').subscribe();
		expectCall('POST', /\/undo\/audit_1$/, {});
		gateway.star({ targetType: 'file', targetId: 'med_1', starred: true }).subscribe();
		expectCall('PUT', /\/favourites$/);
		gateway.duplicates({ folderId: null, files: [] } as never).subscribe();
		expectCall('POST', /\/duplicates$/);
	});

	it('uploads plain files and makes them public or private', () => {
		gateway
			.presignFile({ fileName: 'a.pdf', contentType: 'application/pdf', byteSize: 1, folderId: null })
			.subscribe();
		expectCall('POST', /\/files\/presign$/);
		gateway.finalizeFile('med_1').subscribe();
		expectCall('POST', /\/files\/med_1\/finalize$/, {});
		gateway.cancelUpload('med_1').subscribe();
		expectCall('POST', /\/files\/med_1\/cancel$/, {});
		gateway.cancelUpload('med_1', 'up_1').subscribe();
		expectCall('POST', /\/files\/med_1\/cancel$/, { uploadId: 'up_1' });
		gateway.startMultipart('med_1').subscribe();
		expectCall('POST', /\/files\/med_1\/multipart$/, {});
		gateway.partUrls('med_1', { uploadId: 'up_1', partNumbers: [2] }).subscribe();
		expectCall('POST', /\/files\/med_1\/parts$/, { uploadId: 'up_1', partNumbers: [2] });
		gateway.uploadedParts('med_1', 'up_1').subscribe();
		expectCall('GET', /\/files\/med_1\/parts\?uploadId=up_1$/);
		gateway.finalizeFile('med_1', 'up_1').subscribe();
		expectCall('POST', /\/files\/med_1\/finalize$/, { uploadId: 'up_1' });
		gateway.setVisibility('med_1', 'public').subscribe();
		expectCall('PUT', /\/files\/med_1\/visibility$/, { visibility: 'public' });
		gateway.fileAddress('med_1', 'view').subscribe();
		expectCall('GET', /\/files\/med_1\/address\?as=view$/);
	});

	it('adds, removes and follows versions (media step 3a)', () => {
		const versions = [{ profileKey: 'hero_21x9', fill: 'crop' as const }];
		gateway.addVersions('med_1', { versions }).subscribe();
		expectCall('POST', /\/files\/med_1\/versions$/, { versions });
		gateway.addVersionsToMany({ fileIds: ['med_1', 'med_2'], versions, reservationId: 'res_1' }).subscribe();
		expectCall('POST', /\/library\/versions$/, { fileIds: ['med_1', 'med_2'], versions, reservationId: 'res_1' });
		gateway.versionsStatus(['med_1']).subscribe();
		expectCall('POST', /\/versions\/status$/, { fileIds: ['med_1'] });
		gateway.removeVersion('med_1', 'hero_21x9.crop').subscribe();
		expectCall('DELETE', /\/files\/med_1\/versions\/hero_21x9\.crop$/);
	});

	it('saves a photo’s own text where the image fields save it (A42)', () => {
		const text = { alt: { en: 'Red Banarasi silk saree' }, caption: {} };
		gateway.saveText('med_1', text).subscribe();
		expectCall('PATCH', /\/admin\/media\/med_1$/, text);
	});

	it('reads and changes share links and storage', () => {
		gateway.links('med_1').subscribe();
		expectCall('GET', /\/files\/med_1\/links$/, undefined, false);
		gateway.createLink('med_1', { expiry: '7d', who: 'anyone' }).subscribe();
		expectCall('POST', /\/files\/med_1\/links$/, { expiry: '7d', who: 'anyone' });
		gateway.updateLink('shl_1', { stop: true }).subscribe();
		expectCall('PATCH', /\/links\/shl_1$/, { stop: true });
		gateway.storage().subscribe();
		expectCall('GET', /\/storage$/, undefined, false);
		gateway.checkStorage({ operation: 'upload', bytes: 10, approve: false }).subscribe();
		expectCall('POST', /\/storage\/check$/);
		gateway.releaseHold('res_1').subscribe();
		expectCall('DELETE', /\/storage\/holds\/res_1$/);
		gateway.saveStorageSettings({ othersMayUseOnDemand: true }).subscribe();
		expectCall('PUT', /\/storage\/settings$/, { othersMayUseOnDemand: true });
	});
});

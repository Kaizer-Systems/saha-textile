import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IAttachmentModel } from '@data-access/interfaces/attachment.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class AttachmentService {
	private http = inject(HttpClient);

	getAttachments(payload?: Params): Observable<IAttachmentModel> {
		return this.http.get<IAttachmentModel>(`${environment.URL}/media.json`, { params: payload });
	}
}

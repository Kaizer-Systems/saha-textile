import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IAttachmentModel } from '@data-access/interfaces/attachment.interface';
import { Params } from '@data-access/interfaces/core.interface';

@Injectable({
	providedIn: 'root',
})
export class AttachmentService {
	private http = inject(HttpClient);

	getAttachments(payload?: Params): Observable<IAttachmentModel> {
		return this.http.get<IAttachmentModel>(`${environment.URL}/media.json`, { params: payload });
	}
}

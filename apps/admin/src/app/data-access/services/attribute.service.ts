import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import type { AdminAttributeWrite, AttributeDefinition } from '@saha-textile/contracts';
import { Observable, map } from 'rxjs';

import { IAttribute, IAttributeModel } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

function toRow(definition: AttributeDefinition): IAttribute {
	return { id: definition.code, name: definition.label.en, definition } as unknown as IAttribute;
}

@Injectable({
	providedIn: 'root',
})
export class AttributeService {
	private http = inject(HttpClient);
	private base = () => `${environment.apiUrl}/admin/catalog/attributes`;

	getAttributes(_payload?: Params): Observable<IAttributeModel> {
		return this.getDefinitions().pipe(
			map((rows) => ({ data: rows.map(toRow), total: rows.length }) as IAttributeModel),
		);
	}

	getDefinitions(): Observable<AttributeDefinition[]> {
		return this.http.get<AttributeDefinition[]>(this.base());
	}

	saveAttribute(body: AdminAttributeWrite): Observable<AttributeDefinition> {
		return this.http.post<AttributeDefinition>(this.base(), body);
	}

	deleteAttribute(code: string): Observable<void> {
		return this.http.delete<void>(`${this.base()}/${encodeURIComponent(code)}`);
	}
}

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AssetCategories,
	AssetDisposal,
	DepreciationRun,
	FixedAsset,
	FixedAssetEdit,
	FixedAssetWriteInput,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const ASSET_KEYS = {
	all: ['assets'] as const,
	list: ['assets', 'list'] as const,
	categories: ['assets', 'categories'] as const,
	one: (id: string) => ['assets', 'one', id] as const,
	run: (month: string) => ['assets', 'depreciation', month] as const,
};

/** Fixed assets and depreciation (accounts brief R1–R4). */
@Injectable({ providedIn: 'root' })
export class AssetsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/accounts/assets${path}`;

	list(): Observable<FixedAsset[]> {
		return this.http.get<FixedAsset[]>(this.api());
	}

	categories(): Observable<AssetCategories> {
		return this.http.get<AssetCategories>(this.api('/categories'));
	}

	one(id: string): Observable<FixedAsset> {
		return this.http.get<FixedAsset>(this.api(`/${encodeURIComponent(id)}`));
	}

	create(write: FixedAssetWriteInput): Observable<FixedAsset> {
		return this.http.post<FixedAsset>(this.api(), write);
	}

	update(id: string, edit: FixedAssetEdit): Observable<FixedAsset> {
		return this.http.put<FixedAsset>(this.api(`/${encodeURIComponent(id)}`), edit);
	}

	dispose(id: string, write: AssetDisposal): Observable<FixedAsset> {
		return this.http.post<FixedAsset>(this.api(`/${encodeURIComponent(id)}/dispose`), write);
	}

	preview(month: string): Observable<DepreciationRun> {
		return this.http.get<DepreciationRun>(this.api(`/depreciation/${month}`));
	}

	post(month: string): Observable<DepreciationRun> {
		return this.http.post<DepreciationRun>(this.api(`/depreciation/${month}`), {});
	}
}

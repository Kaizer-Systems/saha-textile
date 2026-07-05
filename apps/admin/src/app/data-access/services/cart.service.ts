import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { ICartModel } from '@data-access/interfaces/cart.interface';

@Injectable({
	providedIn: 'root',
})
export class CartService {
	private http = inject(HttpClient);

	getCartItems(): Observable<ICartModel> {
		return this.http.get<ICartModel>(`${environment.URL}/cart.json`);
	}
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IPaymentDetails } from '@data-access/interfaces/payment-details.interface';

@Injectable({
  providedIn: 'root',
})
export class PaymentDetailsService {
  private http = inject(HttpClient);

  getPaymentAccount(): Observable<IPaymentDetails> {
    return this.http.get<IPaymentDetails>(`${environment.URL}/payment-account.json`);
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Params } from '@angular/router';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IReviewModel } from '@data-access/interfaces/review.interface';

@Injectable({
  providedIn: 'root',
})
export class ReviewService {
  private http = inject(HttpClient);

  getReview(slug: Params): Observable<IReviewModel> {
    return this.http.get<IReviewModel>(`${environment.URL}/review.json`, { params: slug });
  }
}

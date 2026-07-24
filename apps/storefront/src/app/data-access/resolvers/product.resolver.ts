import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';

import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GetProductBySlugAction } from '@data-access/actions/product.action';

export const ProductResolver: ResolveFn<boolean> = (route, _state) => {
  const slug = route.paramMap.get('slug');

  if (!slug) {
    // If no slug is present, return false
    return of(false);
  }

  return inject(Store)
    .dispatch(new GetProductBySlugAction(slug))
    .pipe(
      map(() => true), // Return true if the dispatch is successful
      catchError(() => of(false)), // Return false if there's an error
    );
};

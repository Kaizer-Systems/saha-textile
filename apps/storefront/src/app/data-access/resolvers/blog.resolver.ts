import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';

import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GetBlogBySlugAction } from '@data-access/actions/blog.action';

export const BlogResolver: ResolveFn<boolean> = (route, _state) => {
  const slug = route.paramMap.get('slug');

  if (!slug) {
    // Return false or handle the missing slug case
    return of(false);
  }

  return inject(Store)
    .dispatch(new GetBlogBySlugAction(slug))
    .pipe(
      map(() => true), // Return true if dispatch is successful
      catchError(() => of(false)), // Return false on error
    );
};

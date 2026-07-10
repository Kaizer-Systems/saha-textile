import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Observable } from 'rxjs';

import { Berlin } from './berlin/berlin';
import { Denver } from './denver/denver';
import { Madrid } from './madrid/madrid';
import { Osaka } from './osaka/osaka';
import { Paris } from './paris/paris';
import { Rome } from './rome/rome';
import { Tokyo } from './tokyo/tokyo';
import { injectHomePageQuery } from '@data-access/queries/theme.queries';
import { ThemeOptionService } from '@data-access/services/theme-option.service';

@Component({
  selector: 'app-themes',
  templateUrl: './themes.html',
  styleUrls: ['./themes.scss'],
  imports: [Paris, Tokyo, Osaka, Rome, Madrid, Berlin, Denver, AsyncPipe],
})
export class Themes {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private themeOptionService = inject(ThemeOptionService);

  public slug = signal<string>('paris');

  private readonly homePageQuery = injectHomePageQuery(() => this.slug());
  homePage$: Observable<any> = toObservable(computed(() => this.homePageQuery.data()));

  constructor() {
    this.route.params.subscribe(params => {
      this.slug.set(params['slug'] ? params['slug'] : 'paris');
    });
    // Preloader + 404-on-error were handled by the old NGXS action; drive them
    // off the query now.
    effect(() => {
      this.themeOptionService.preloader = this.homePageQuery.isFetching();
      if (this.homePageQuery.isError()) {
        void this.router.navigate(['/404']);
      }
    });
  }
}

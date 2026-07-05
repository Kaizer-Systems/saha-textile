import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Berlin } from './berlin/berlin';
import { Denver } from './denver/denver';
import { Madrid } from './madrid/madrid';
import { Osaka } from './osaka/osaka';
import { Paris } from './paris/paris';
import { Rome } from './rome/rome';
import { Tokyo } from './tokyo/tokyo';
import { GetHomePageAction } from '@data-access/actions/theme.action';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { ThemeState } from '@data-access/states/theme.state';

@Component({
  selector: 'app-themes',
  templateUrl: './themes.html',
  styleUrls: ['./themes.scss'],
  imports: [Paris, Tokyo, Osaka, Rome, Madrid, Berlin, Denver, AsyncPipe],
})
export class Themes {
  private store = inject(Store);
  private route = inject(ActivatedRoute);
  private themeOptionService = inject(ThemeOptionService);

  homePage$: Observable<any> = inject(Store).select(ThemeState.homePage);

  public slug: string;

  constructor() {
    this.route.params.subscribe(params => {
      this.themeOptionService.preloader = true;
      this.slug = params['slug'] ? params['slug'] : 'paris';
      this.store.dispatch(new GetHomePageAction(params['slug'] ? params['slug'] : 'paris'));
    });
  }
}

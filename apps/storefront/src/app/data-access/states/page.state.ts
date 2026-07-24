import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { ContactUsAction, GetFaqsAction } from '@data-access/actions/page.action';
import { IContactUsModel, IFaq, IPage } from '@data-access/interfaces/page.interface';
import { PageService } from '../services/page.service';

export class PageStateModel {
  page = {
    data: [] as IPage[],
    total: 0,
  };
  faq = {
    data: [] as IFaq[],
    total: 0,
  };
  selectedPage: IPage | null;
}

@State<PageStateModel>({
  name: 'page',
  defaults: {
    page: {
      data: [],
      total: 0,
    },
    faq: {
      data: [],
      total: 0,
    },
    selectedPage: null,
  },
})
@Injectable()
export class PageState {
  private pageService = inject(PageService);

  @Selector()
  static faq(state: PageStateModel) {
    return state.faq;
  }

  @Action(GetFaqsAction)
  getFaqs(ctx: StateContext<PageStateModel>) {
    this.pageService.skeletonLoader = true;
    return this.pageService.getFaqs().pipe(
      tap({
        next: result => {
          ctx.patchState({
            faq: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.pageService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(ContactUsAction)
  contactUs(_ctx: StateContext<IContactUsModel>, { payload: _payload }: ContactUsAction) {
    // contact api logic here
  }
}

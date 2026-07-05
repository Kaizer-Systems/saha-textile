import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetStatesAction } from '@data-access/actions/state.action';
import { IStates } from '@data-access/interfaces/state.interface';
import { StateService } from '../services/state.service';

export class StateStateModel {
  state = {
    data: [] as IStates[],
  };
}

@State<StateStateModel>({
  name: 'state',
  defaults: {
    state: {
      data: [],
    },
  },
})
@Injectable()
export class StateState {
  private stateService = inject(StateService);

  @Selector()
  static state(state: StateStateModel) {
    return state.state;
  }

  @Selector()
  static states(state: StateStateModel) {
    return (country_id?: number | null) => {
      if (country_id)
        return state.state.data
          .filter(element => element.country_id == country_id)
          .map(st => {
            return { label: st?.name, value: st?.id, country_id: st?.country_id };
          });
      else
        return state.state.data.map(st => {
          return { label: st?.name, value: st?.id, country_id: st?.country_id };
        });
    };
  }

  @Action(GetStatesAction)
  getStates(ctx: StateContext<StateStateModel>, _action: GetStatesAction) {
    const state = ctx.getState();
    if (state?.state?.data?.length) {
      // If the state has been already loaded
      // we just break the execution
      return true;
    }
    return this.stateService.getStates().pipe(
      tap({
        next: result => {
          ctx.patchState({
            state: {
              data: result,
            },
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}

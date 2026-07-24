import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetAttributesAction } from '@data-access/actions/attribute.action';
import { IAttribute, IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { AttributeService } from '../services/attribute.service';

export class AttributeStateModel {
  attribute = {
    data: [] as IAttribute[],
    total: 0,
  };
  attribute_values: IAttributeValue[];
}

@State<AttributeStateModel>({
  name: 'attribute',
  defaults: {
    attribute: {
      data: [],
      total: 0,
    },
    attribute_values: [],
  },
})
@Injectable()
export class AttributeState {
  private attributeService = inject(AttributeService);

  @Selector()
  static attribute(state: AttributeStateModel) {
    return state.attribute;
  }

  @Selector()
  static attribute_value(state: AttributeStateModel) {
    return (id: number | null) => {
      if (!id) return [];
      return state?.attribute_values
        .filter(attr_val => +attr_val.attribute_id === id)
        ?.map((value: IAttributeValue) => {
          return { label: value?.value, value: value?.id };
        });
    };
  }

  @Action(GetAttributesAction)
  getAttributes(ctx: StateContext<AttributeStateModel>, action: GetAttributesAction) {
    this.attributeService.skeletonLoader = true;
    return this.attributeService.getAttributes(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            attribute: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.attributeService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}

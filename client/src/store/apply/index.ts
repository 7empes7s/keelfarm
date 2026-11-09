// The store's apply (#257): every ServerEvent's handler, from its area's file, and each area's share of a snapshot.
// A new event goes in its area's file (or a new one listed here); the type below fails until every event has one.
import type { WorldSnapshot } from '../../../../shared/types';
import type { State } from '../../store';
import * as agents from './agents';
import * as company from './company';
import * as floors from './floors';
import * as office from './office';
import * as phone from './phone';
import * as qa from './qa';
import * as settings from './settings';
import * as world from './world';
import type { ApplyCtx, Handler, Live } from './types';

export const AREAS = { agents, company, floors, office, phone, qa, settings, world };

export const APPLY: { [K in Live]: Handler<K> } = {
  ...agents.handlers,
  ...company.handlers,
  ...floors.handlers,
  ...office.handlers,
  ...phone.handlers,
  ...qa.handlers,
  ...settings.handlers,
  ...world.handlers,
};

/** The state a snapshot replaces, from every area, set at once. */
export const snapshotState = (d: WorldSnapshot, c: ApplyCtx): Partial<State> => Object.assign({}, ...Object.values(AREAS).map((a) => a.snapshot(d, c)));

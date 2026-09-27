// Today's plan from the current evidence. Recomputed from records; nothing
// about the plan is stored until a session starts from it.
import { useMemo } from 'react';
import { weakTargetsFor } from '../practice/exercises';
import type { DailyPlan } from '../../domain/planner';
import { planDay } from '../../domain/planner';
import type { MaintenanceStatus } from '../../domain/maintenance';
import type { ModeId } from '../../domain/modes';
import type { SessionRecord } from '../../domain/records';
import { CORE_IDS, maintenanceFor, type ModeOverview, planInfo, stageInfo, type StageInfo, switchingFor, geometryFor, currentSetup } from './derive';
import type { AppState } from './AppStore';
import type { TrialEvents } from '../../domain/adaptive';

export interface TodayModel {
  readonly plan: DailyPlan;
  readonly stage: StageInfo;
  readonly primary: ModeId;
  readonly maintenance: ReadonlyMap<ModeId, MaintenanceStatus>;
  readonly lastSession: SessionRecord | null;
  readonly unfinished: SessionRecord | null;
  readonly todaysSession: SessionRecord | null;
}

export function buildToday(state: AppState, overviews: ReadonlyMap<ModeId, ModeOverview>, recent: readonly TrialEvents[] = []): TodayModel | null {
  const profile = state.data.profile;
  if (!profile) return null;
  const stage = stageInfo(state.data, overviews, state.today);
  const primary = profile.primaryMode;
  const maintenance = new Map<ModeId, MaintenanceStatus>();
  for (const mode of CORE_IDS) {
    const o = overviews.get(mode);
    if (o) maintenance.set(mode, maintenanceFor(state.data, o, primary, state.today));
  }
  const primaryOverview = overviews.get(primary) as ModeOverview;
  const setup = currentSetup(state.data.setups);
  const weak = recent.length > 0 ? weakTargetsFor({ recent, layout: primaryOverview.layout, geometry: geometryFor(setup) }).codes : [];
  const switching = switchingFor(state.data, primary);
  const others = CORE_IDS.filter((m) => m !== primary).map((m) => planInfo(state.data, overviews.get(m) as ModeOverview, maintenance.get(m) ?? null, []));
  const lastFatigue = [...state.data.sessions].filter((s) => s.fatigueAfter !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)?.fatigueAfter ?? null;
  const plan = planDay({
    date: state.today,
    budgetMinutes: profile.dailyMinutes,
    practiceWeekdays: profile.practiceWeekdays,
    primary: planInfo(state.data, primaryOverview, null, weak),
    others,
    switching: { appropriate: !!switching && overviews.get(switching.pair[1])?.started === true, pair: switching?.pair ?? null, stage: switching?.stage ?? null },
    lastFatigue,
    idFor: (i) => `${state.today}-${i}`,
  });
  const sessions = [...state.data.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const unfinished = sessions.filter((s) => s.status === 'active').at(-1) ?? null;
  const lastSession = sessions.filter((s) => s.status !== 'active').at(-1) ?? null;
  const todaysSession = sessions.filter((s) => s.localDate === state.today && s.template !== 'free').at(-1) ?? null;
  return { plan, stage, primary, maintenance, lastSession, unfinished, todaysSession };
}

export function useToday(state: AppState, overviews: ReadonlyMap<ModeId, ModeOverview>, recent: readonly TrialEvents[] | null): TodayModel | null {
  return useMemo(() => buildToday(state, overviews, recent ?? []), [state, overviews, recent]);
}

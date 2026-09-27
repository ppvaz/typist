import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ModeId } from '../../domain/modes';
import type { AppState, AppStore } from './AppStore';
import { allOverviews, currentSetup, type ModeOverview } from './derive';

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider is missing');
  return store;
}

export function useAppState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Per-mode derived overviews, recomputed only when data or the date change. */
export function useOverviews(): Map<ModeId, ModeOverview> {
  const state = useAppState();
  return useMemo(() => allOverviews(state.data, state.today, state.browserSession), [state.data, state.today, state.browserSession]);
}

export function useSetup() {
  const state = useAppState();
  return useMemo(() => currentSetup(state.data.setups), [state.data.setups]);
}

import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-400-italic.css';
import '@fontsource/newsreader/latin-500.css';
import '../design/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerOffline } from './app/runtime/offline';
import { AppStore } from './app/store/AppStore';
import { StoreProvider } from './app/store/react';

const store = new AppStore();
(window as unknown as { __typist?: AppStore }).__typist = store;

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

void store.init().then(() => registerOffline(store));

if (import.meta.env.DEV) {
  // Development and browser tests only: synthetic history fixtures.
  void import('./dev/fixtures').then((fixtures) => {
    (window as unknown as { __typistDev?: unknown }).__typistDev = {
      loadHistory: (mode: Parameters<typeof fixtures.loadHistory>[1], sets: Parameters<typeof fixtures.loadHistory>[2]) => fixtures.loadHistory(store, mode, sets),
      loadProbes: (probes: Parameters<typeof fixtures.loadProbes>[1]) => fixtures.loadProbes(store, probes),
    };
  });
}

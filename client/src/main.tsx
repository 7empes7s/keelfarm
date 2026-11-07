import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './net';
import { watchUpdates } from './clientUpdate';
import { registerServiceWorker } from './pwa';
import { useStore } from './store';
import { standalone, watchViewport } from './viewport';
import { keepOfficeOpen } from './ui/outsideLinks';
import './ui/a11y';
import './styles.css';
import './design.css';

connect();
watchUpdates();
watchViewport();
keepOfficeOpen(standalone());
registerServiceWorker();
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__swarmStore = useStore;
createRoot(document.getElementById('root')!).render(<App />);

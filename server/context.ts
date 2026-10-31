import { wireAutomation } from './automation';
import { Hub } from './hub';
import { MatchService } from './matches';
import { ObsController } from './obs/client';
import { OverlayService } from './overlays';
import { SettingsService } from './settings';
import { Simulator } from './simulate';
import { openStore, Store } from './store';
import { VmixPusher } from './vmix/push';

export interface Context {
  store: Store;
  settings: SettingsService;
  matches: MatchService;
  overlays: OverlayService;
  hub: Hub;
  vmix: VmixPusher;
  obs: ObsController;
  sim: Simulator;
}

export async function createContext(dataDir: string): Promise<Context> {
  const store = await openStore(dataDir);
  const settings = new SettingsService(store);
  const matches = new MatchService(store, settings);
  const overlays = new OverlayService(store, settings);
  const hub = new Hub(() => matches.activeId(), (id) => {
    try { return matches.state(id); } catch { return null; }
  });
  const vmix = new VmixPusher(() => settings.get().vmix);
  const obs = new ObsController(() => settings.get().obs);
  const sim = new Simulator(matches, () => hub.broadcast({ type: 'clients', ...hub.counts() }));
  wireAutomation(matches, overlays, settings, vmix, obs);

  matches.on('change', ({ matchId, state }) => hub.broadcastState(matchId, state));
  matches.on('active', () => hub.refreshAll());
  matches.on('removed', () => hub.refreshAll());
  overlays.on('overlay', (map) => hub.broadcast({ type: 'overlay', overlays: map }));
  overlays.on('trigger', (trigger) => hub.broadcast({ type: 'trigger', trigger }));
  return { store, settings, matches, overlays, hub, vmix, obs, sim };
}

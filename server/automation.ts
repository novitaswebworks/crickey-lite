import { ChangeEvent, MatchService } from './matches';
import { ObsController } from './obs/client';
import { OverlayService } from './overlays';
import { SettingsService } from './settings';
import { payloadFor } from './triggers';
import { VmixPusher } from './vmix/push';

/** Reacts to scoring: fires auto-trigger overlays and the vMix / OBS integrations. */
export function wireAutomation(matches: MatchService, overlays: OverlayService, settings: SettingsService, vmix: VmixPusher, obs: ObsController): void {
  matches.on('change', ({ matchId, state, kind }: ChangeEvent) => {
    if (matchId !== matches.activeId()) return;
    vmix.onState(state);
    const fx = state.effects;
    if (kind !== 'append' || !fx) return;
    const auto = settings.get().autoTrigger;
    const show = (name: Parameters<OverlayService['show']>[0]) => overlays.show(name, payloadFor(name, state), matchId);

    // Auto-trigger hockey transient overlays
    if ((state as unknown as { sport?: string }).sport === 'hockey') {
      const hFx = (state as unknown as { effects?: { goal?: unknown; card?: unknown; penaltyCorner?: unknown } }).effects;
      if (hFx?.goal) show('hockey/goal');
      if (hFx?.card) show('hockey/card');
      if (hFx?.penaltyCorner) show('hockey/penalty-corner');
      return;
    }

    if (fx.boundary === 4) { if (auto.four) show('four'); vmix.fire('four'); obs.fire('four'); }
    if (fx.boundary === 6) { if (auto.six) show('six'); vmix.fire('six'); obs.fire('six'); }
    if (fx.wicket) { if (auto.wicket) show('wicket'); vmix.fire('wicket'); obs.fire('wicket'); }
    if (fx.milestones.length && auto.milestone) show('milestone');
    if (fx.overCompleted && auto.overSummary) show('over-summary');
    if (fx.newBatter && auto.newBatter) show('new-batter');
  });
  matches.on('active', () => vmix.reset());
}

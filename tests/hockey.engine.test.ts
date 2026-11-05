import { describe, expect, it } from 'vitest';
import {
  appendHockeyEvent,
  computeHockeyState,
  formatClock,
  HockeyEngineEvent,
  HockeyMatchConfig,
} from '../server/engine/hockey';
import { hockeyEventSchema } from '../server/schemas';
import { payloadFor } from '../server/triggers';
import { flatState } from '../server/vmix/feed';
import type { LiveState } from '../server/engine';

const config: HockeyMatchConfig = {
  id: 'h1',
  title: 'Olympic Hockey Final',
  venue: 'National Hockey Stadium',
  playersPerSide: 11,
  teams: {
    A: {
      id: '1',
      name: 'India',
      shortName: 'IND',
      color: '#0000FF',
      players: [
        { id: 'p1', name: 'Harmanpreet Singh' },
        { id: 'p2', name: 'Manpreet Singh' },
        { id: 'p3', name: 'PR Sreejesh' },
      ],
    },
    B: {
      id: '2',
      name: 'Germany',
      shortName: 'GER',
      color: '#000000',
      players: [
        { id: 'p10', name: 'Mats Grambusch' },
        { id: 'p11', name: 'Christopher Ruhr' },
      ],
    },
  },
  settings: {
    periods: 4,
    periodDurationMins: 15,
  },
};

describe('Hockey Engine', () => {
  it('formats clock correctly into MM:SS', () => {
    expect(formatClock(900_000)).toBe('15:00');
    expect(formatClock(885_000)).toBe('14:45');
    expect(formatClock(5_000)).toBe('00:05');
    expect(formatClock(0)).toBe('00:00');
  });

  describe('Goals accumulate correctly and are undoable', () => {
    it('records goals and can undo by replaying events slice', () => {
      const baseTime = 1700000000000;
      let events: HockeyEngineEvent[] = [];

      // Start clock
      const e1 = appendHockeyEvent(config, events, { type: 'START_CLOCK', at: baseTime });
      events.push(e1.event);
      expect(e1.state.scoreA).toBe(0);
      expect(e1.state.scoreB).toBe(0);

      // India scores a goal
      const e2 = appendHockeyEvent(config, events, {
        type: 'GOAL',
        teamSide: 'A',
        scorerId: 'p1',
        assistId: 'p2',
        kind: 'PC',
        at: baseTime + 60_000,
      });
      events.push(e2.event);

      expect(e2.state.scoreA).toBe(1);
      expect(e2.state.scoreB).toBe(0);
      expect(e2.state.teams.A.goals).toHaveLength(1);
      expect(e2.state.teams.A.goals[0].scorerName).toBe('Harmanpreet Singh');
      expect(e2.state.teams.A.goals[0].assistName).toBe('Manpreet Singh');
      expect(e2.state.effects?.goal?.scoreA).toBe(1);

      // Germany scores a field goal
      const e3 = appendHockeyEvent(config, events, {
        type: 'GOAL',
        teamSide: 'B',
        scorerId: 'p11',
        kind: 'FG',
        at: baseTime + 120_000,
      });
      events.push(e3.event);

      expect(e3.state.scoreA).toBe(1);
      expect(e3.state.scoreB).toBe(1);

      // Undo the last goal by replaying events without e3
      const undoneEvents = events.slice(0, -1);
      const stateAfterUndo = computeHockeyState(config, undoneEvents, baseTime + 120_000);

      expect(stateAfterUndo.scoreA).toBe(1);
      expect(stateAfterUndo.scoreB).toBe(0);
      expect(stateAfterUndo.teams.B.goals).toHaveLength(0);
    });
  });

  describe('Clock elapsed time is computed deterministically from timestamps', () => {
    it('computes displayMs accurately across start, stop, and adjustment events', () => {
      const t0 = 1700000000000;
      let events: HockeyEngineEvent[] = [];

      // Initial state: 15:00 (900,000 ms)
      const s0 = computeHockeyState(config, events, t0);
      expect(s0.clock.displayMs).toBe(900_000);
      expect(s0.clock.running).toBe(false);

      // Start clock at t0
      const e1 = appendHockeyEvent(config, events, { type: 'START_CLOCK', at: t0 });
      events.push(e1.event);

      // Check snapshot 30 seconds into running: 900_000 - 30_000 = 870_000 ms
      const s1 = computeHockeyState(config, events, t0 + 30_000);
      expect(s1.clock.running).toBe(true);
      expect(s1.clock.displayMs).toBe(870_000);

      // Stop clock at t0 + 45s
      const e2 = appendHockeyEvent(config, events, { type: 'STOP_CLOCK', at: t0 + 45_000 });
      events.push(e2.event);

      const s2 = computeHockeyState(config, events, t0 + 100_000); // clock is stopped, time advance has no effect
      expect(s2.clock.running).toBe(false);
      expect(s2.clock.displayMs).toBe(855_000); // 900s - 45s = 855s

      // Adjust clock by +10s (adds 10,000 ms to remaining time)
      const e3 = appendHockeyEvent(config, events, { type: 'ADJUST_CLOCK', deltaMs: 10_000, at: t0 + 50_000 });
      events.push(e3.event);

      const s3 = computeHockeyState(config, events, t0 + 60_000);
      expect(s3.clock.displayMs).toBe(865_000);

      // Advance period to Q2: resets clock back to 15:00
      const e4 = appendHockeyEvent(config, events, { type: 'SET_PERIOD', period: 2, at: t0 + 70_000 });
      events.push(e4.event);

      const s4 = computeHockeyState(config, events, t0 + 70_000);
      expect(s4.period).toBe(2);
      expect(s4.periodLabel).toBe('Q2');
      expect(s4.clock.displayMs).toBe(900_000);
      expect(s4.clock.running).toBe(false);
    });
  });

  describe('Sin-bin expiry is calculated correctly', () => {
    it('manages Green (2m) and Yellow (5m) card suspensions and expirations', () => {
      const t0 = 1700000000000;
      let events: HockeyEngineEvent[] = [];

      // Issue Green Card (2 min = 120,000 ms) to Manpreet Singh
      const e1 = appendHockeyEvent(config, events, {
        type: 'CARD',
        teamSide: 'A',
        playerId: 'p2',
        kind: 'green',
        durationMs: 120_000,
        at: t0,
      });
      events.push(e1.event);

      // At t0 + 60s (1 min in): remaining should be 60,000 ms and active = true
      const s1 = computeHockeyState(config, events, t0 + 60_000);
      expect(s1.suspensions).toHaveLength(1);
      expect(s1.suspensions[0].active).toBe(true);
      expect(s1.suspensions[0].remainingMs).toBe(60_000);

      // At t0 + 120s (2 min in): remaining should be 0 and active = false
      const s2 = computeHockeyState(config, events, t0 + 120_000);
      expect(s2.suspensions[0].active).toBe(false);
      expect(s2.suspensions[0].remainingMs).toBe(0);

      // Issue Yellow Card (5 min = 300,000 ms) to Christopher Ruhr
      const e2 = appendHockeyEvent(config, events, {
        type: 'CARD',
        teamSide: 'B',
        playerId: 'p11',
        kind: 'yellow',
        durationMs: 300_000,
        at: t0 + 130_000,
      });
      events.push(e2.event);

      const s3 = computeHockeyState(config, events, t0 + 200_000);
      expect(s3.suspensions).toHaveLength(2);
      // Manpreet (green) is expired
      expect(s3.suspensions[0].active).toBe(false);
      // Christopher (yellow) is still active: 300s - 70s = 230s = 230,000 ms
      expect(s3.suspensions[1].active).toBe(true);
      expect(s3.suspensions[1].remainingMs).toBe(230_000);
    });
  });

  describe('Shootout rounds track scores properly', () => {
    it('records shootout attempts and tracks shootout scores', () => {
      let events: HockeyEngineEvent[] = [];

      // Start shootout
      const e1 = appendHockeyEvent(config, events, { type: 'START_SHOOTOUT' });
      events.push(e1.event);
      expect(e1.state.status).toBe('shootout');
      expect(e1.state.periodLabel).toBe('SO');

      // Round 1: India scores, Germany misses
      const e2 = appendHockeyEvent(config, events, {
        type: 'SHOOTOUT_ATTEMPT',
        teamSide: 'A',
        round: 1,
        scored: true,
        takerId: 'p1',
      });
      events.push(e2.event);

      const e3 = appendHockeyEvent(config, events, {
        type: 'SHOOTOUT_ATTEMPT',
        teamSide: 'B',
        round: 1,
        scored: false,
        takerId: 'p10',
      });
      events.push(e3.event);

      expect(e3.state.shootout?.scoreA).toBe(1);
      expect(e3.state.shootout?.scoreB).toBe(0);
      expect(e3.state.shootout?.rounds).toHaveLength(1);
      expect(e3.state.shootout?.rounds[0].attemptA?.scored).toBe(true);
      expect(e3.state.shootout?.rounds[0].attemptB?.scored).toBe(false);

      // Round 2: India misses, Germany scores
      const e4 = appendHockeyEvent(config, events, {
        type: 'SHOOTOUT_ATTEMPT',
        teamSide: 'A',
        round: 2,
        scored: false,
        takerId: 'p2',
      });
      events.push(e4.event);

      const e5 = appendHockeyEvent(config, events, {
        type: 'SHOOTOUT_ATTEMPT',
        teamSide: 'B',
        round: 2,
        scored: true,
        takerId: 'p11',
      });
      events.push(e5.event);

      expect(e5.state.shootout?.scoreA).toBe(1);
      expect(e5.state.shootout?.scoreB).toBe(1);
      expect(e5.state.shootout?.rounds).toHaveLength(2);
    });
  });

  describe('Phase 3: Schema validation, triggers, and vMix feeds', () => {
    it('validates hockeyEventSchema correctly', () => {
      // Valid events
      expect(hockeyEventSchema.parse({ type: 'START_CLOCK', at: 1000 })).toMatchObject({ type: 'START_CLOCK', at: 1000 });
      expect(hockeyEventSchema.parse({ type: 'STOP_CLOCK', at: 2000 })).toMatchObject({ type: 'STOP_CLOCK', at: 2000 });
      expect(hockeyEventSchema.parse({ type: 'ADJUST_CLOCK', deltaMs: 5000 })).toMatchObject({ type: 'ADJUST_CLOCK', deltaMs: 5000 });
      expect(hockeyEventSchema.parse({ type: 'GOAL', teamSide: 'A', scorerId: 'p1', kind: 'PC', at: 3000 })).toMatchObject({
        type: 'GOAL', teamSide: 'A', scorerId: 'p1', kind: 'PC',
      });
      expect(hockeyEventSchema.parse({ type: 'CARD', teamSide: 'B', playerId: 'p10', kind: 'yellow', durationMs: 300000, at: 4000 })).toMatchObject({
        type: 'CARD', teamSide: 'B', playerId: 'p10', kind: 'yellow', durationMs: 300000,
      });
      expect(hockeyEventSchema.parse({ type: 'PENALTY_CORNER', teamSide: 'A', at: 5000 })).toMatchObject({
        type: 'PENALTY_CORNER', teamSide: 'A',
      });
      expect(hockeyEventSchema.parse({ type: 'SET_PERIOD', period: 3 })).toMatchObject({
        type: 'SET_PERIOD', period: 3,
      });

      // Invalid events
      expect(() => hockeyEventSchema.parse({ type: 'GOAL', teamSide: 'X', scorerId: 'p1' })).toThrow();
      expect(() => hockeyEventSchema.parse({ type: 'CARD', teamSide: 'A', playerId: 'p1', kind: 'purple', durationMs: 100 })).toThrow();
      expect(() => hockeyEventSchema.parse({ type: 'SET_PERIOD', period: 5 })).toThrow();
    });

    it('generates correct overlay payloads via payloadFor()', () => {
      let events: HockeyEngineEvent[] = [];
      const baseTime = 1700000000000;
      const e1 = appendHockeyEvent(config, events, { type: 'START_CLOCK', at: baseTime });
      events.push(e1.event);
      const e2 = appendHockeyEvent(config, events, {
        type: 'GOAL',
        teamSide: 'A',
        scorerId: 'p1',
        assistId: 'p2',
        kind: 'FG',
        at: baseTime + 10_000,
      });
      events.push(e2.event);
      const e3 = appendHockeyEvent(config, events, {
        type: 'CARD',
        teamSide: 'B',
        playerId: 'p11',
        kind: 'yellow',
        durationMs: 300_000,
        at: baseTime + 20_000,
      });
      events.push(e3.event);
      const e4 = appendHockeyEvent(config, events, {
        type: 'PENALTY_CORNER',
        teamSide: 'A',
        at: baseTime + 30_000,
      });
      events.push(e4.event);

      const state = e4.state as unknown as LiveState;

      // hockey/goal payload
      const goalPayload = payloadFor('hockey/goal', state);
      expect(goalPayload).toMatchObject({
        scorer: 'Harmanpreet Singh',
        assist: 'Manpreet Singh',
        kind: 'FG',
        scoreA: 1,
        scoreB: 0,
        teamShort: 'IND',
      });

      // hockey/card payload
      const cardPayload = payloadFor('hockey/card', state);
      expect(cardPayload).toMatchObject({
        playerName: 'Christopher Ruhr',
        cardKind: 'yellow',
        durationLabel: '5m',
        teamShort: 'GER',
      });

      // hockey/penalty-corner payload
      const pcPayload = payloadFor('hockey/penalty-corner', state);
      expect(pcPayload).toMatchObject({
        teamShort: 'IND',
        matchId: 'h1',
      });

      // hockey/starting11 payload
      const s11Payload = payloadFor('hockey/starting11', state, { side: 'A' });
      expect(s11Payload).toMatchObject({
        side: 'A',
        teamName: 'India',
        teamShort: 'IND',
        tournament: 'FIH PRO LEAGUE',
      });

      // hockey/substitutes payload
      const subsPayload = payloadFor('hockey/substitutes', state, { side: 'B' });
      expect(subsPayload).toMatchObject({
        side: 'B',
        teamName: 'Germany',
        teamShort: 'GER',
      });

      // hockey/scoreboard-banner payload
      const sbPayload = payloadFor('hockey/scoreboard-banner', state);
      expect(sbPayload).toMatchObject({
        scoreA: 1,
        scoreB: 0,
        periodLabel: 'Q1',
        venue: 'National Hockey Stadium',
      });
    });

    it('exports structured hockey fields via flatState() for vMix', () => {
      let events: HockeyEngineEvent[] = [];
      const baseTime = 1700000000000;
      const e1 = appendHockeyEvent(config, events, { type: 'START_CLOCK', at: baseTime });
      events.push(e1.event);
      const e = appendHockeyEvent(config, events, {
        type: 'GOAL',
        teamSide: 'A',
        scorerId: 'p1',
        kind: 'PC',
        at: baseTime + 10_000,
      });

      const flat = flatState(e.state as unknown as LiveState);
      expect(flat).toMatchObject({
        match_title: 'Olympic Hockey Final',
        venue: 'National Hockey Stadium',
        period: 'Q1',
        clock_running: '1',
        team_a_name: 'India',
        team_a_short: 'IND',
        team_a_score: 1,
        team_b_name: 'Germany',
        team_b_short: 'GER',
        team_b_score: 0,
        score: '1 - 0',
        score_text: 'IND 1 - 0 GER',
      });
      expect(flat.latest_goal_scorer).toContain('Harmanpreet Singh');
    });
  });
});

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MatchService } from '../server/matches';
import { openStore, Store } from '../server/store';
import { SettingsService } from '../server/settings';
import { flatState } from '../server/vmix/feed';
import { payloadFor } from '../server/triggers';
import type { HockeyState } from '../server/engine/hockey';

async function tempStore(): Promise<{ store: Store; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hockey-test-'));
  const store = await openStore(dir);
  return { store, dir };
}

describe('Hockey Integration & Coexistence with Cricket', () => {
  it('allows Cricket and Hockey matches to coexist simultaneously in the database', async () => {
    const { store, dir } = await tempStore();
    try {
      const settings = new SettingsService(store);
      const matches = new MatchService(store, settings);

      // Create two teams
      const teamA = store.insert('teams', { name: 'India', shortName: 'IND', color: '#0000FF', logoPath: null });
      const teamB = store.insert('teams', { name: 'Germany', shortName: 'GER', color: '#000000', logoPath: null });

      // Add players
      store.insert('players', { teamId: teamA.id, name: 'Harmanpreet Singh', shortName: 'Harman', shirtNo: '13', role: 'Defender', orderIdx: 1 }, teamA.id);
      store.insert('players', { teamId: teamA.id, name: 'PR Sreejesh', shortName: 'Sreejesh', shirtNo: '16', role: 'Goalkeeper', orderIdx: 2 }, teamA.id);
      store.insert('players', { teamId: teamB.id, name: 'Mats Grambusch', shortName: 'Mats', shirtNo: '10', role: 'Midfielder', orderIdx: 1 }, teamB.id);
      store.insert('players', { teamId: teamB.id, name: 'Christopher Ruhr', shortName: 'Ruhr', shirtNo: '11', role: 'Forward', orderIdx: 2 }, teamB.id);

      // 1. Create a Cricket match
      const cricketMatch = matches.create({
        sport: 'cricket',
        title: 'T20 Cricket Final',
        venue: 'Eden Gardens',
        teamAId: teamA.id,
        teamBId: teamB.id,
        overs: 20,
        playersPerSide: 2,
        tossWinner: 'A',
        tossDecision: 'bat',
        xiA: [],
        xiB: [],
      });

      // 2. Create a Hockey match
      const hockeyMatch = matches.create({
        sport: 'hockey',
        title: 'Olympic Hockey Final',
        venue: 'Yves-du-Manoir',
        teamAId: teamA.id,
        teamBId: teamB.id,
        overs: 0,
        playersPerSide: 2,
        tossWinner: null,
        tossDecision: null,
        xiA: [],
        xiB: [],
        periods: 4,
        periodDurationMins: 15,
      });

      // Both matches exist in list()
      const list = matches.list();
      expect(list).toHaveLength(2);
      const hSummary = list.find((m) => m.id === hockeyMatch.id);
      const cSummary = list.find((m) => m.id === cricketMatch.id);
      expect(hSummary?.sport).toBe('hockey');
      expect(cSummary?.sport).toBe('cricket');

      // 3. Score the hockey match: start clock, score a goal, issue a card
      matches.setActive(hockeyMatch.id);
      expect(matches.activeId()).toBe(hockeyMatch.id);

      const t0 = 1700000000000;
      // Start clock
      matches.append(hockeyMatch.id, { type: 'START_CLOCK', at: t0 } as any);

      // Score Goal
      matches.append(hockeyMatch.id, {
        type: 'GOAL',
        teamSide: 'A',
        scorerId: '1',
        kind: 'FG',
        at: t0 + 30_000,
      } as any);

      // Issue Card
      matches.append(hockeyMatch.id, {
        type: 'CARD',
        teamSide: 'B',
        playerId: '4',
        kind: 'yellow',
        durationMs: 300_000,
        at: t0 + 60_000,
      } as any);

      const hState = matches.state(hockeyMatch.id) as unknown as HockeyState;
      expect(hState.sport).toBe('hockey');
      expect(hState.scoreA).toBe(1);
      expect(hState.scoreB).toBe(0);
      expect(hState.teams.A.goals).toHaveLength(1);
      expect(hState.teams.B.cards).toHaveLength(1);

      // Verify vMix flatState for the active hockey match
      const hVmix = flatState(hState as any);
      expect(hVmix.score).toBe('1 - 0');
      expect(hVmix.team_a_score).toBe(1);
      expect(hVmix.team_b_score).toBe(0);
      expect(hVmix.period).toBe('Q1');
      expect(hVmix.latest_goal_scorer).toContain('Harmanpreet Singh');

      // Verify overlay triggers for hockey
      const goalOverlayPayload = payloadFor('hockey/goal', hState as any);
      expect(goalOverlayPayload.scorer).toBe('Harmanpreet Singh');
      expect(goalOverlayPayload.teamShort).toBe('IND');

      const cardOverlayPayload = payloadFor('hockey/card', hState as any);
      expect(cardOverlayPayload.playerName).toBe('Christopher Ruhr');
      expect(cardOverlayPayload.cardKind).toBe('yellow');

      // 4. Test Undo: undoing removes the card
      const stateAfterUndo = matches.undo(hockeyMatch.id) as unknown as HockeyState;
      expect(stateAfterUndo.teams.B.cards).toHaveLength(0);
      expect(stateAfterUndo.teams.A.goals).toHaveLength(1);
      expect(stateAfterUndo.scoreA).toBe(1);

      // 5. Active match switch: switch to Cricket match
      matches.setActive(cricketMatch.id);
      expect(matches.activeId()).toBe(cricketMatch.id);
      const cState = matches.state(cricketMatch.id);
      const cVmix = flatState(cState);
      // Returns cricket fields
      expect(cVmix.overs).toBeDefined();
      expect(cVmix.striker_name).toBeDefined();

      // Switch back to Hockey match
      matches.setActive(hockeyMatch.id);
      const hVmixActive = flatState(matches.state(hockeyMatch.id));
      expect(hVmixActive.score).toBe('1 - 0');
      expect(hVmixActive.clock_text).toBeDefined();
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

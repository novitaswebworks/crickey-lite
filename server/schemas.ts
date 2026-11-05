import { z } from 'zod';

const id = z.string().min(1).max(64);
const runs = z.number().int().min(0).max(30);

const wicket = z.object({
  kind: z.enum(['bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket', 'retiredout', 'obstructing', 'timedout', 'handled', 'hittwice']),
  out: id.optional(),
  fielder: id.optional(),
  crossed: z.boolean().optional(),
  incoming: id.optional(),
});

export const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('START_INNINGS'), battingSide: z.enum(['A', 'B']).optional() }),
  z.object({ type: z.literal('SET_BATTERS'), striker: id, nonStriker: id }),
  z.object({ type: z.literal('NEW_BATTER'), batter: id }),
  z.object({ type: z.literal('SET_BOWLER'), bowler: id }),
  z.object({
    type: z.literal('BALL'),
    extra: z.enum(['wide', 'noball', 'bye', 'legbye', 'dead']).optional(),
    runs: runs.optional(),
    noballExtra: z.enum(['bye', 'legbye']).optional(),
    boundary: z.boolean().optional(),
    overthrows: runs.optional(),
    wicket: wicket.optional(),
  }),
  z.object({ type: z.literal('SWAP_STRIKE') }),
  z.object({ type: z.literal('PENALTY'), runs: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('ADJUSTMENT'), runs: z.number().int().min(-500).max(500), note: z.string().max(200).optional() }),
  z.object({ type: z.literal('RETIRE'), batter: id }),
  z.object({ type: z.literal('END_OVER') }),
  z.object({ type: z.literal('END_INNINGS'), reason: z.enum(['declared', 'abandoned']).optional() }),
  z.object({ type: z.literal('ADD_PLAYER'), side: z.enum(['A', 'B']), player: z.object({ id, name: z.string().min(1).max(60), shortName: z.string().max(12).optional() }) }),
  z.object({ type: z.literal('RENAME_PLAYER'), playerId: id, name: z.string().min(1).max(60) }),
  z.object({ type: z.literal('REVISED_TARGET'), target: z.number().int().min(1).max(1000), overs: z.number().int().min(1).max(100).optional() }),
  z.object({ type: z.literal('MATCH_RESULT'), kind: z.enum(['tie', 'noresult', 'won']), winner: z.enum(['A', 'B']).optional(), text: z.string().max(160).optional() }),
]);

export const teamSchema = z.object({
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().min(2).max(5).transform((s) => s.toUpperCase()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #1d4ed8'),
});

export const playerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().max(12).default(''),
  shirtNo: z.string().trim().max(4).default(''),
  role: z.string().trim().max(24).default(''),
});

export const matchSchema = z.object({
  sport: z.enum(['cricket', 'hockey']).default('cricket'),
  title: z.string().trim().max(100).default(''),
  venue: z.string().trim().max(100).default(''),
  teamAId: z.number().int(),
  teamBId: z.number().int(),
  overs: z.number().int().min(1).max(100).default(20),
  playersPerSide: z.number().int().min(2).max(11),
  tossWinner: z.enum(['A', 'B']).nullable().default(null),
  tossDecision: z.enum(['bat', 'bowl']).nullable().default(null),
  xiA: z.array(z.number().int()).default([]),
  xiB: z.array(z.number().int()).default([]),
  powerplayOvers: z.number().int().min(0).max(50).optional(),
  limitBowlerOvers: z.boolean().optional(),
  // Hockey-specific fields (ignored for cricket)
  periods: z.number().int().min(2).max(4).optional(),
  periodDurationMins: z.number().int().min(5).max(60).optional(),
});

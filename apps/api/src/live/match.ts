// One online game lives in @fruitcats/match (packages/match/src/match.ts), so the same code runs a match on the API and,
// for a Friend game played directly between two devices, on the host's device (packages/match/src/peer.ts).
export {
  IDLE_MS, Match, RESULT_KEEP_MS, newMatchId, newSeed, plainestMove, rebuild, takeBackPoint,
  type MatchHost, type MatchRecord, type Played, type SeatRecord,
} from '@fruitcats/match';

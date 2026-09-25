// The balance run: which decks play whom, how many games, and what counts as a problem.
//
//   quick (the deploy gate)  the starter decks against each other
//   full  (nightly)          + random decks for every Hero Cat and partner family, starters with cards
//                            swapped, per-card impact, and a check that the bot is strong enough to trust

import config from '../balance.config.json';
import { CARDS, DECKS, cardName, type DeckList } from '../lib/engine';
import { runJobs } from '../lib/pool';
import { mulberry, seedFrom } from '../lib/rng';
import { finishRun, newRun, pct, reportProgress, type Problem, type RunSummary } from '../lib/runs';
import { families, mutateDeck, playableHeroes, randomDeck } from './decks';
import type { Contestant, GameRecord, MatchJob } from './match';
import { cardImpact, gameShape, matchups } from './stats';

export interface BalanceConfig {
  block: { starterOverall: [number, number]; starterMatchupMin: number };
  warn: {
    starterOverall: [number, number]; starterMatchupMin: number; firstPlayer: [number, number];
    cardDelta: number; cardMinGames: number; deckVsStarters: number; botSanityMin: number;
  };
  quick: { gamesPerPair: number };
  full: { gamesPerPair: number; randomDecksPerCombo: number; mutatedPerStarter: number; swaps: number; gamesVsStarter: number; sanityGames: number };
}

// Imported, not read from disk, so the single-file runner bundle carries it.
export const loadConfig = (): BalanceConfig => config as unknown as BalanceConfig;

export interface BalanceOptions {
  quick: boolean;
  /** Multiplies every game count: 0.2 for a smoke test, 5 for a long night. */
  scale?: number;
  threads?: number;
  /** Extra decks to put through the gauntlet (an LLM's deck ideas, a player's custom deck). */
  extraDecks?: DeckList[];
  quiet?: boolean;
}

interface Section { name: string; jobs: MatchJob[] }

const starter = (key: string, skill?: number): Contestant => ({ key: skill === undefined ? key : `${key}@${skill}`, deck: DECKS[key], skill });

function pairs(a: Contestant[], b: Contestant[], games: number, tag: string): MatchJob[] {
  const jobs: MatchJob[] = [];
  for (const x of a) for (const y of b) if (x.key !== y.key) jobs.push({ a: x, b: y, seed: seedFrom(`${tag}:${x.key}:${y.key}`), from: 0, to: games });
  return jobs;
}

function plan(cfg: BalanceConfig, o: BalanceOptions): Section[] {
  const scale = o.scale ?? 1;
  const n = (x: number) => Math.max(2, Math.round(x * scale));
  const keys = Object.keys(DECKS);
  const starters = keys.map((k) => starter(k));
  // Each unordered pair once: seats alternate inside a job, so A-vs-B already covers B-vs-A.
  const starterJobs = starters.flatMap((x, i) => starters.slice(i + 1).map((y) => ({ a: x, b: y, seed: seedFrom(`starters:${x.key}:${y.key}`), from: 0, to: n(o.quick ? cfg.quick.gamesPerPair : cfg.full.gamesPerPair) })));
  const sections: Section[] = [{ name: 'starters', jobs: starterJobs }];
  const extra = (o.extraDecks ?? []).map((d): Contestant => ({ key: d.name, deck: d }));
  if (extra.length) sections.push({ name: 'extra', jobs: pairs(extra, starters, n(cfg.full.gamesVsStarter), 'extra') });
  if (o.quick) return sections;

  const rng = mulberry(seedFrom('generated-decks'));
  const generated: Contestant[] = [];
  for (const hero of playableHeroes()) {
    const own = CARDS[hero].family;
    for (const partner of [undefined, ...families().filter((f) => f !== own)]) {
      for (let i = 0; i < cfg.full.randomDecksPerCombo; i++) {
        const name = `random ${cardName(hero).split(',')[0]}${partner ? ` + ${partner}` : ''} #${i + 1}`;
        generated.push({ key: name, deck: randomDeck(rng, hero, partner, name) });
      }
    }
  }
  const mutated: Contestant[] = [];
  for (const key of keys) {
    for (let i = 0; i < cfg.full.mutatedPerStarter; i++) {
      const name = `${key} ~${cfg.full.swaps} #${i + 1}`;
      mutated.push({ key: name, deck: mutateDeck(rng, DECKS[key], cfg.full.swaps, name) });
    }
  }
  sections.push({ name: 'random', jobs: pairs(generated, starters, n(cfg.full.gamesVsStarter), 'random') });
  sections.push({ name: 'mutated', jobs: pairs(mutated, starters, n(cfg.full.gamesVsStarter), 'mutated') });
  // The bot at full strength against itself at half strength, same deck: if it can't beat a coin-flipping
  // version of itself clearly, its balance numbers say more about the bot than about the cards.
  sections.push({ name: 'sanity', jobs: keys.map((k) => ({ a: starter(k, 1), b: starter(k, 0.5), seed: seedFrom(`sanity:${k}`), from: 0, to: n(cfg.full.sanityGames) })) });
  return sections;
}

export async function runBalance(o: BalanceOptions): Promise<RunSummary> {
  const cfg = loadConfig();
  const kind = o.quick ? 'balance-check' : 'balance';
  const run = newRun(kind);
  const sections = plan(cfg, o);
  const jobs = sections.flatMap((s) => s.jobs);
  let lastShown = 0;
  reportProgress(run, kind, 'bot games', 0, jobs.reduce((n, j) => n + j.to - j.from, 0));
  const byJob = await runJobs(jobs, {
    threads: o.threads,
    progress: (done, total) => {
      reportProgress(run, kind, 'bot games', done, total);
      if (o.quiet || Date.now() - lastShown < 2000) return;
      lastShown = Date.now();
      process.stderr.write(`\r  ${done}/${total} games`);
    },
  });
  if (!o.quiet) process.stderr.write('\r');
  const records: Record<string, GameRecord[]> = {};
  let j = 0;
  for (const s of sections) records[s.name] = s.jobs.flatMap(() => byJob[j++]);
  const all = Object.values(records).flat();

  const problems: Problem[] = [];
  const keys = Object.keys(DECKS);
  const st = matchups(records.starters);
  const shape = gameShape(records.starters);
  const [lo, hi] = cfg.block.starterOverall, [wlo, whi] = cfg.warn.starterOverall;
  for (const k of keys) {
    const r = st.rate(k);
    if (r < lo || r > hi) problems.push({ level: 'block', text: `${DECKS[k].name} wins ${pct(r)} overall (allowed ${pct(lo)}–${pct(hi)}).` });
    else if (r < wlo || r > whi) problems.push({ level: 'warn', text: `${DECKS[k].name} wins ${pct(r)} overall (target ${pct(wlo)}–${pct(whi)}).` });
    for (const o2 of keys) {
      if (o2 === k) continue;
      const m = st.rate(k, o2);
      if (m < cfg.block.starterMatchupMin) problems.push({ level: 'block', text: `${DECKS[k].name} wins only ${pct(m)} against ${DECKS[o2].name} (minimum ${pct(cfg.block.starterMatchupMin)}).` });
      else if (m < cfg.warn.starterMatchupMin) problems.push({ level: 'warn', text: `${DECKS[k].name} wins only ${pct(m)} against ${DECKS[o2].name}.` });
    }
  }
  const [flo, fhi] = cfg.warn.firstPlayer;
  if (shape.firstPlayer < flo || shape.firstPlayer > fhi) problems.push({ level: 'warn', text: `The starting Yarn holder wins ${pct(shape.firstPlayer)} of games.` });

  const cards = cardImpact(all);
  const outliers = cards.filter((c) => c.games >= cfg.warn.cardMinGames && Math.abs(c.delta) > cfg.warn.cardDelta);
  for (const c of outliers.filter((c) => c.delta > 0)) problems.push({ level: 'warn', text: `${cardName(c.id)}: decks win ${pct(c.winRate)} of games they play it in, ${c.delta > 0 ? '+' : ''}${(100 * c.delta).toFixed(0)} points over their usual rate.` });

  const suspicious: { name: string; hero: string; vsStarters: number; cards: Record<string, number> }[] = [];
  const generatedDecks = new Map<string, DeckList>();
  for (const s of sections) if (s.name !== 'starters' && s.name !== 'sanity') for (const job of s.jobs) generatedDecks.set(job.a.key, job.a.deck);
  for (const name of generatedDecks.keys()) {
    const recs = [...(records.random ?? []), ...(records.mutated ?? []), ...(records.extra ?? [])].filter((r) => r.seats.includes(name));
    const r = matchups(recs).rate(name);
    if (r > cfg.warn.deckVsStarters) {
      const deck = generatedDecks.get(name)!;
      suspicious.push({ name, hero: deck.hero, vsStarters: r, cards: deck.cards });
      problems.push({ level: 'warn', text: `A generated deck, "${name}", beats the starters ${pct(r)} of the time (list in the report).` });
    }
  }
  const extraRates = (o.extraDecks ?? []).map((d) => ({ name: d.name, vsStarters: matchups((records.extra ?? []).filter((r) => r.seats.includes(d.name))).rate(d.name) }));

  const sanity: Record<string, number> = {};
  if (records.sanity) {
    const sm = matchups(records.sanity);
    for (const k of keys) {
      sanity[k] = sm.rate(`${k}@1`, `${k}@0.5`);
      if (sanity[k] < cfg.warn.botSanityMin) problems.push({ level: 'warn', text: `The bot beats a half-random copy of itself only ${pct(sanity[k])} of the time with ${DECKS[k].name}: treat that deck's numbers with care.` });
    }
  }

  const overall = Object.fromEntries(keys.map((k) => [k, st.rate(k)]));
  const matrix = Object.fromEntries(keys.map((a) => [a, Object.fromEntries(keys.filter((b) => b !== a).map((b) => [b, st.rate(a, b)]))]));
  const details = {
    starters: { overall, matrix, ...shape },
    cardOutliers: outliers.map((c) => ({ ...c, name: cardName(c.id) })),
    topCards: cards.slice(0, 8).map((c) => ({ ...c, name: cardName(c.id) })),
    suspiciousDecks: suspicious,
    extraDecks: extraRates,
    sanity,
    sections: Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.length])),
  };
  const md = markdown(kind, keys, st, shape, problems, outliers, suspicious, sanity, extraRates, records);
  return finishRun(run, kind, all.length, problems, details, md);
}

function markdown(
  kind: string, keys: string[], st: ReturnType<typeof matchups>, shape: ReturnType<typeof gameShape>, problems: Problem[],
  outliers: ReturnType<typeof cardImpact>, suspicious: { name: string; vsStarters: number; cards: Record<string, number> }[],
  sanity: Record<string, number>, extra: { name: string; vsStarters: number }[], records: Record<string, GameRecord[]>,
): string {
  const lines: string[] = [];
  lines.push(`# ${kind === 'balance-check' ? 'Balance check' : 'Balance run'}`, '');
  lines.push(`Games: ${Object.entries(records).map(([k, v]) => `${k} ${v.length}`).join(', ')}`, '');
  lines.push('## Problems', '');
  lines.push(...(problems.length ? problems.map((p) => `- **${p.level}**: ${p.text}`) : ['None.']), '');
  lines.push('## Starter decks', '', `| Win rate of row vs column | ${keys.map((k) => DECKS[k].name).join(' | ')} | Overall |`, `|---|${keys.map(() => '---|').join('')}---|`);
  for (const a of keys) lines.push(`| ${DECKS[a].name} | ${keys.map((b) => (a === b ? '—' : pct(st.rate(a, b)))).join(' | ')} | **${pct(st.rate(a))}** |`);
  lines.push('', `Starting Yarn holder wins ${pct(shape.firstPlayer)}. Average game: ${shape.avgRounds.toFixed(1)} rounds, ${shape.avgActions.toFixed(0)} actions.`, '');
  lines.push('| Deck | Grew Up | Grow Up round | Cards in hand at the end |', '|---|---|---|---|');
  for (const k of keys) lines.push(`| ${DECKS[k].name} | ${pct(shape.grewUp[k] ?? 0)} | ${(shape.grewUpRound[k] ?? 0).toFixed(1)} | ${(shape.handEnd[k] ?? 0).toFixed(1)} |`);
  if (outliers.length) {
    lines.push('', '## Card outliers', '', "| Card | Games played in | Win rate | Points above its deck's usual rate |", '|---|---|---|---|');
    for (const c of outliers) lines.push(`| ${cardName(c.id)} | ${c.games} | ${pct(c.winRate)} | ${c.delta > 0 ? '+' : ''}${(100 * c.delta).toFixed(0)} |`);
  }
  if (extra.length) {
    lines.push('', '## Submitted decks', '');
    for (const d of extra) lines.push(`- ${d.name}: ${pct(d.vsStarters)} against the starters`);
  }
  if (suspicious.length) {
    lines.push('', '## Decks that beat the starters', '');
    for (const d of suspicious) {
      lines.push(`### ${d.name}: ${pct(d.vsStarters)}`, '');
      lines.push(Object.entries(d.cards).sort().map(([id, q]) => `${q}× ${cardName(id)}`).join(', '), '');
    }
  }
  if (Object.keys(sanity).length) {
    lines.push('', '## Bot check', '', 'Full-strength bot against a half-random copy of itself, same deck:', '');
    for (const k of keys) lines.push(`- ${DECKS[k].name}: ${pct(sanity[k])}`);
  }
  return lines.join('\n') + '\n';
}

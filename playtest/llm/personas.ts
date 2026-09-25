// Who the LLM plays as. The bots already measure how the cards do with sensible play; a persona is there to
// play the way the bots don't, and to say how it felt.

export interface Persona {
  key: string;
  name: string;
  /** How to play. */
  style: string;
  /** What to look out for, for the end-of-game report. */
  watch: string;
}

export const PERSONAS: Record<string, Persona> = {
  exploit: {
    key: 'exploit',
    name: 'Exploit hunter',
    style: 'You are an expert card-game player hunting for anything unfair. Try unusual lines: odd attack orders, holding Treats for Pounces, taking the Yarn at strange times, sacrificing units, racing. Win if you can, but above all probe for combinations or cards that are too strong or never worth playing.',
    watch: 'cards or combinations that felt too strong, cards that never felt worth playing, and any rule interaction that seemed broken',
  },
  aggro: {
    key: 'aggro',
    name: 'Aggressive player',
    style: 'You are an aggressive, experienced player. You want to win fast: develop cheap units, attack the Hero Cat whenever it is sensible, and only trade units when it clearly helps the race.',
    watch: 'whether attacking felt rewarding or pointless, and what stopped you from winning faster',
  },
  newcomer: {
    key: 'newcomer',
    name: 'New player',
    style: 'You are new to Fruitcats, and new to card games in general. Play the way a sensible beginner would: do what the cards seem to invite, and don\'t plan far ahead.',
    watch: 'anything confusing: rules, card text, why something happened, or what a choice meant',
  },
};

export const ANSWER_FORMAT = 'Reply with one or two short sentences of reasoning, then a last line "Answer: <number>" (for a pick-several choice: "Answer: H2 H5", or "Answer: none").';

/** Repeated at the end of every question: small local models follow the last instruction they read. */
export const ANSWER_REMINDER = 'Remember: end your reply with a line "Answer: <number>".';

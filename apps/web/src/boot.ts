// The game's entry point: load the card sets (built in, then any newer card packs on the site), and only
// then start the game, so every screen sees the full catalog from its first render.
import { loadPacks } from './content';

loadPacks().catch(() => []).finally(() => import('./main'));

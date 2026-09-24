// The cards the game plays with. The engine has none of its own: the sets in content/ are handed to it
// here, before anything reads the catalog (import this first). The public game loads released sets only;
// prototypes are for playtests.
import { registerSet } from '@fruitcats/engine';
import { loadContent } from '../../../content';

loadContent(registerSet);

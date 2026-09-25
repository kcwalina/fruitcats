// Tests run the engine with every set loaded, prototypes included: the engine itself has no cards.
import { registerSet } from '../src/index';
import { loadContent } from '../../../content';

loadContent(registerSet, { prototypes: true });

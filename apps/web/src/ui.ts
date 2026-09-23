// Small helpers shared by the screens: asset URLs, HTML escaping, family colours, the settings gear.

import { CARDS } from '@fruitcats/engine';

export const BASE = import.meta.env.BASE_URL;
export const artUrl = (key: string) => `${BASE}sb1/${key}.webp`;
export const cardUrl = (key: string) => `${BASE}cards/sb1/${key}.webp`;

export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Each fruit family is a class with its own signature mechanic. */
export const FAMILY_INFO: Record<string, { mechanic: string; hint: string }> = {
  Citrus: { mechanic: 'Zest', hint: 'bonuses when it isn’t your first card this round' },
  Orchard: { mechanic: 'Ripen', hint: 'units grow +1/+1 every round' },
  Tropical: { mechanic: 'Sprout', hint: 'extra Treats now, Lush payoffs at 7+' },
};
export const famClass = (id: string) => `fam-${(CARDS[id]?.family ?? 'garden').toLowerCase()}`;

/** The gear that opens Settings: in Home's corner, in the menu headers, and beside Rules in a game. */
export function settingsButton(extraClass = ''): string {
  return `<button data-click="ui:settings" class="icon-button settings-button ${extraClass}" title="Settings" aria-label="Settings">
      <img src="${BASE}ui/icon-settings.webp" alt=""></button>`;
}

/** The button at the left of a menu header: Home (the house icon), or back one step (an arrow). */
export function backButton(click = 'ui:back', label = 'Home'): string {
  const face = click === 'ui:back' ? `<img src="${BASE}ui/icon-home.webp" alt="">` : '<span class="back-arrow" aria-hidden="true">‹</span>';
  return `<button class="icon-button back-button" data-click="${click}" title="${label}" aria-label="${label}">${face}</button>`;
}

// Behaviour shared by the rulebook and card-list pages.
//
//  • the contents sit open beside the text on wide screens and fold away above them on phones;
//  • every heading has a "#" link: clicking it copies the link to that section, for sending to
//    playtesters ("read §8 Attacking": https://fruitcats.viamochi.com/rules.html#8-attacking);
//  • "Back to top" shows up only after you've scrolled down.

const toc = document.getElementById('toc') as HTMLDetailsElement | null;
if (toc) {
  const wide = matchMedia('(min-width: 900px)');
  toc.open = wide.matches;
  wide.addEventListener('change', () => (toc.open = wide.matches));
  toc.addEventListener('click', (e) => {
    if (!wide.matches && (e.target as HTMLElement).closest('a')) toc.open = false;
  });
}

// A link to a section (the deck builder's "Deck building rules" opens §11.1): the browser jumps there
// before the styles and fonts have loaded, and the page then grows around it, so jump again once it
// has settled. Instantly: arriving from a link shouldn't glide past thirteen sections.
const linked = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
if (linked) {
  const jump = () => linked.scrollIntoView({ behavior: 'instant' });
  window.addEventListener('load', jump, { once: true });
  void document.fonts?.ready.then(jump);
}

// "Back to top" appears only once you've scrolled a screen or so down.
const toTop = document.querySelector<HTMLElement>('.to-top');
if (toTop) {
  const update = () => toTop.classList.toggle('shown', window.scrollY > window.innerHeight * 0.8);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

const flash = (anchor: HTMLElement, text: string) => {
  const note = document.createElement('span');
  note.className = 'copied';
  note.textContent = text;
  anchor.after(note);
  setTimeout(() => note.remove(), 1600);
};

/** The clipboard API needs permission and a secure context; fall back to the old textarea trick. */
function copy(text: string): Promise<boolean> {
  const legacy = () => {
    // The box sits (invisibly) in view: an off-screen one would scroll the page and cancel the
    // link's own jump to its section.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none;padding:0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  };
  if (!navigator.clipboard) return Promise.resolve(legacy());
  return navigator.clipboard.writeText(text).then(() => true, () => legacy());
}

document.addEventListener('click', (event) => {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('.doc .anchor');
  if (!anchor) return;
  // The link still jumps to the section as usual; copying is a bonus.
  const url = new URL(anchor.getAttribute('href')!, location.href).href;
  void copy(url).then((ok) => flash(anchor, ok ? 'Link copied' : 'Link in the address bar'));
});

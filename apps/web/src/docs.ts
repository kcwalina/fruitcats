// Behaviour shared by the rulebook and card-list pages.
//
//  • the contents sit open beside the text on wide screens and fold away above them on phones;
//  • every heading has a "#" link: clicking it copies the link to that section, for sending to
//    playtesters ("read §8 Attacking": https://fruitcats.viamochi.com/rules.html#8-attacking).

const toc = document.getElementById('toc') as HTMLDetailsElement | null;
if (toc) {
  const wide = matchMedia('(min-width: 900px)');
  toc.open = wide.matches;
  wide.addEventListener('change', () => (toc.open = wide.matches));
  toc.addEventListener('click', (e) => {
    if (!wide.matches && (e.target as HTMLElement).closest('a')) toc.open = false;
  });
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

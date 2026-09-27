// Signing in on the Portal itself. The game keeps its sign-in in this site's storage, and the Portal uses it when it's
// there; but a player signed in somewhere else (the home-screen app keeps its own storage, so does another browser)
// arrives signed out, and the game can't be opened at its sign-in screen from a link. So the Portal asks for the
// email and the code itself, through the same sign-in module (auth.ts): the same account, and afterwards the game on
// this site is signed in too. Existing accounts only: accounts are made in the game.

import { AuthError, codeDigits, session, signOut, startSignIn, submitCode, type Pending } from '../auth';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const message = (e: unknown) => (e instanceof AuthError || e instanceof Error ? e.message : 'That didn’t work. Try again.');

/** Draws the sign-in form in `box` and calls `done` once signed in. */
export function showSignIn(box: HTMLElement, done: () => void): void {
  let pending: Pending | null = null;
  let busy = false;
  let error = '';

  const draw = () => {
    box.innerHTML = pending
      ? `<form class="signin" data-step="code">
          <p>We sent a code to <b>${esc(pending.sentTo || pending.email)}</b>. Type it here.</p>
          <div class="field"><label for="si-code">Code</label>
            <input id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required></div>
          ${error ? `<p class="si-error" role="alert">${esc(error)}</p>` : ''}
          <div class="si-buttons"><button class="go" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>
            <button class="link" type="button" data-si="back">Use another email</button></div>
        </form>`
      : `<form class="signin" data-step="email">
          <p>Sign in with your Via Mochi account to see the Portal. It's the account you use in the game.</p>
          <div class="field"><label for="si-email">Email</label>
            <input id="si-email" type="email" autocomplete="email" required value="${esc(session()?.email ?? '')}"></div>
          ${error ? `<p class="si-error" role="alert">${esc(error)}</p>` : ''}
          <div class="si-buttons"><button class="go" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Email me a code'}</button></div>
        </form>`;
    box.querySelector<HTMLInputElement>('input')?.focus();
  };

  box.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; error = '';
    const input = box.querySelector<HTMLInputElement>('input')!;
    try {
      if (!pending) {
        const email = input.value.trim();
        busy = true; draw();
        pending = await startSignIn(email);
      } else {
        const code = codeDigits(input.value, pending.codeLength);
        busy = true; draw();
        await submitCode(pending, code);
        busy = false;
        done();
        return;
      }
    } catch (err) {
      error = message(err);
    }
    busy = false;
    draw();
  };
  box.onclick = (e) => {
    if ((e.target as HTMLElement).closest('[data-si="back"]')) { pending = null; error = ''; draw(); }
  };
  draw();
}

/** Signed in, but not as the Portal's owner: say who, and offer to sign out and in again. */
export function showWrongAccount(box: HTMLElement, done: () => void): void {
  const s = session();
  box.innerHTML = `<div class="signin"><p>The Portal is for its owner's account. You're signed in as <b>${esc(s?.displayName ?? '')}</b>
    (${esc(s?.email ?? 'unknown email')}).</p><div class="si-buttons"><button class="go" type="button" data-si="out">Sign out and use another account</button></div></div>`;
  box.onclick = (e) => {
    if ((e.target as HTMLElement).closest('[data-si="out"]')) { signOut(); showSignIn(box, done); }
  };
  box.onsubmit = null;
}

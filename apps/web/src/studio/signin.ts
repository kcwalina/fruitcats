// Signing in to the Studio with a Via Mochi account: the same account players have, by email and a code, no
// password (src/auth.ts). A new artist creates their account here. In development (?dev), pick a pretend account.

import { AuthError, accountExists, codeDigits, invitesRequired, resend, startSignIn, startSignUp, submitCode, useInvite, type Pending } from '../auth';
import { esc, BASE } from '../ui';
import { DEV, DEV_ACCOUNTS, setDevUser } from './api';

type Step = 'email' | 'invite' | 'details' | 'code';

let step: Step = 'email';
let email = '';
let displayName = '';
let code = '';
let pending: Pending | null = null;
let busy = false;
let error = '';
/** Via Mochi's own invite code (new accounts need one while sign-up is by invitation), from the Studio's invite link. */
const linkCode = new URLSearchParams(location.search).get('account') ?? '';
let invite = linkCode;
/** The email has a sign-in but never finished its account: after the invite code, sign in. */
let inviteThenSignIn = false;


export function renderSignIn(inviting: boolean, notice = ''): string {
  const intro = inviting
    ? '<p class="si-lead">You’ve been invited to make images for Fruitcats. Sign in, or create your account, to open your project.</p>'
    : '<p class="si-lead">Where artists upload their images for Fruitcats. Make them with the tools of your choice; here you upload them and see them on the cards.</p>';
  let body = '';
  if (DEV) {
    body = `<p class="si-small">Development: choose a pretend account.</p>
      <div class="si-dev">${DEV_ACCOUNTS.map(([id, label]) => `<button class="btn" data-click="dev:${id}">${esc(label)}</button>`).join('')}</div>`;
  } else if (step === 'email') {
    body = `<label class="field">Your email
        <input data-in="email" type="email" autocomplete="email" value="${esc(email)}" placeholder="you@example.com" ${busy ? 'disabled' : ''}></label>
      <button class="btn primary wide" data-click="si:email" ${busy ? 'disabled' : ''}>${busy ? 'One moment…' : 'Continue'}</button>
      <p class="si-small">No password: we email you a code. It’s the same Via Mochi account the game uses.</p>`;
  } else if (step === 'invite') {
    body = `<p class="si-small">New to Via Mochi: <b>${esc(email)}</b>. <button class="link" data-click="si:back">Use a different email</button></p>
      <label class="field">Invite code <small>It came with your invitation to the Studio</small>
        <input data-in="invite" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" value="${esc(invite)}" ${busy ? 'disabled' : ''}></label>
      <button class="btn primary wide" data-click="si:invite" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Continue'}</button>`;
  } else if (step === 'details') {
    body = `<p class="si-small">New to Via Mochi: <b>${esc(email)}</b>. <button class="link" data-click="si:back">Use a different email</button></p>
      <label class="field">Your name <small>What we’ll see on your comments and images</small>
        <input data-in="name" maxlength="40" autocomplete="name" value="${esc(displayName)}" ${busy ? 'disabled' : ''}></label>
      <button class="btn primary wide" data-click="si:details" ${busy ? 'disabled' : ''}>${busy ? 'Sending your code…' : 'Email me a code'}</button>`;
  } else {
    const length = pending?.codeLength ?? 8;
    body = `<p class="si-small">We sent a ${length}-digit code to <b>${esc(pending?.sentTo ?? email)}</b>.</p>
      <label class="field">Code
        <input data-in="code" class="si-code" inputmode="numeric" autocomplete="one-time-code" value="${esc(code)}" ${busy ? 'disabled' : ''}></label>
      <button class="btn primary wide" data-click="si:code" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Sign in'}</button>
      <p class="si-small">Nothing there? Check spam, or <button class="link" data-click="si:resend">send a new code</button>.
        <button class="link" data-click="si:back">Change the email</button>.</p>`;
  }
  return `<main class="si">
    <div class="si-art" aria-hidden="true">
      <div class="si-fan">${['foil/SP1-X01', 'signature/SP1-X03-kitten', 'gold/SP1-X02'].map((f) =>
        `<div class="si-card"><div class="si-window"><span>Your image</span></div><img src="${BASE}cards/sp1/frames/${f}.webp" alt=""></div>`).join('')}</div>
      <p>Make the image with your own tools and upload it here. We add the frame, the name and the rules, and you see it on the card straight away.</p>
    </div>
    <div class="si-panel">
      <div class="brand"><img src="${BASE}icons/icon-192.png" alt=""><span>Fruitcats <b>Artist Studio</b></span></div>
      <h1>${inviting ? 'Welcome!' : 'Sign in'}</h1>
      ${intro}
      ${body}
      <p class="si-error" role="alert">${esc(error || notice)}</p>
    </div>
  </main>`;
}

export function signInInput(el: HTMLInputElement, done: () => void, render: () => void) {
  const f = el.dataset.in;
  if (f === 'email') email = el.value.trim();
  else if (f === 'name') displayName = el.value;
  else if (f === 'invite') invite = el.value;
  else if (f === 'code') {
    code = codeDigits(el.value, pending?.codeLength ?? 0);
    if (el.value !== code) el.value = code;
    if (pending && code.length === pending.codeLength && !busy) void signInClick('code', done, render);
  }
}

export async function signInClick(action: string, done: () => void, render: () => void) {
  if (action.startsWith('dev:')) { setDevUser(action.slice(4)); done(); return; }
  if (action === 'back') { step = 'email'; error = ''; code = ''; pending = null; render(); return; }
  if (busy) return;
  error = '';
  const work = async (run: () => Promise<void>) => {
    busy = true; render();
    try { await run(); } catch (e) {
      error = e instanceof AuthError ? e.message : 'Something went wrong. Please try again.';
      if (e instanceof AuthError && e.code === 'expired') step = pending ? 'code' : 'email';
    }
    busy = false; render();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.si input:not([type=checkbox]):not(:disabled)')?.focus());
  };
  if (action === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error = 'Please enter your email address.'; render(); return; }
    await work(async () => {
      inviteThenSignIn = false;
      if (await accountExists(email)) { pending = await startSignIn(email); code = ''; step = 'code'; return; }
      if (!(await invitesRequired())) { step = 'details'; return; }
      // The Studio's invite link carries the code: use it without asking.
      if (invite.trim()) {
        try { await useInvite(invite); step = 'details'; return; } catch { invite = ''; }
      }
      step = 'invite';
    });
  } else if (action === 'invite') {
    if (!invite.trim()) { error = 'Please type your invite code.'; render(); return; }
    await work(async () => {
      await useInvite(invite);
      if (inviteThenSignIn) { pending = await startSignIn(email); code = ''; step = 'code'; } else step = 'details';
    });
  } else if (action === 'details') {
    if (!displayName.trim()) error = 'Please enter your name.';
    if (error) { render(); return; }
    await work(async () => {
      pending = await startSignUp(email, displayName.trim());
      code = ''; step = 'code';
    });
  } else if (action === 'code') {
    if (!pending) return;
    if (code.length !== pending.codeLength) { error = `The code has ${pending.codeLength} digits.`; render(); return; }
    await work(async () => {
      try { await submitCode(pending!, code); }
      catch (e) {
        // Signed in to an email that never finished making its account: it needs an invite like any new one.
        if (e instanceof AuthError && e.code === 'invite_required' && pending?.flow === 'signIn') {
          inviteThenSignIn = true; pending = null; step = 'invite';
          throw new AuthError('invite_required', 'This email doesn’t have an account yet. Type your invite code to make one.');
        }
        throw e;
      }
      step = 'email'; pending = null; code = ''; done();
    });
  } else if (action === 'resend' && pending) {
    await work(async () => { pending = await resend(pending!); code = ''; error = 'We sent a new code.'; });
  }
}

export function signInEnter(el: HTMLInputElement, done: () => void, render: () => void) {
  const f = el.dataset.in;
  if (f === 'email') void signInClick('email', done, render);
  else if (f === 'invite') void signInClick('invite', done, render);
  else if (f === 'code') void signInClick('code', done, render);
}

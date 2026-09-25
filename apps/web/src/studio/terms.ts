// The Artist Studio's own terms: what someone agrees to by using the Studio. Separate from the game's Terms of Use
// (docs/legal/terms-of-use.md): an artist may never play the game, and a player who later opens the Studio sees these.
// Accepted once per account and version (POST /v1/studio/terms). A new version asks everyone again.
//
// DRAFT: written for the owner to review before real artists see it. It describes how the Studio works; the use of
// the art in the game is settled in each artist's own agreement with us.

export const STUDIO_TERMS_VERSION = 'studio-2026-09-draft-1';

export const STUDIO_TERMS = `
<h3>What the Studio is</h3>
<p>The Fruitcats Artist Studio is where you upload the images you make for Fruitcats, see them on the cards, and
talk about them with us. You make your images with your own tools; the Studio only receives them.</p>

<h3>Your images</h3>
<ul>
  <li><b>They stay yours.</b> Uploading an image doesn’t give it away.</li>
  <li>By uploading, you let us <b>store it, show it on card previews, and share it with the people reviewing your
    project</b>, so we can work on it together.</li>
  <li><b>Using an image in the game</b> is agreed between you and us, in our agreement for the project. Nothing
    goes into the game without that.</li>
</ul>

<h3>Keeping them safe</h3>
<ul>
  <li>Every version you upload is kept. The Studio never overwrites or deletes an image.</li>
  <li>Only you and your project’s reviewers can see your images and comments.</li>
  <li>If you’d like your uploads deleted, tell us and we will.</li>
</ul>

<h3>Your account</h3>
<ul>
  <li>The Studio is for adults: you need to be 18 or older.</li>
  <li>You sign in with a Via Mochi account, the same kind the game uses. Using the Studio doesn’t sign you up for
    the game or anything you’d pay for.</li>
  <li>We use your name and email only to run the Studio and to talk with you.</li>
</ul>

<h3>Changes</h3>
<p>If these terms change, the Studio shows you the new version and asks again.</p>
`;

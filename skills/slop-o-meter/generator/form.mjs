// The slop-o-meter generator's page body, built from the rubric. Used by build.mjs here (the standalone index.html) and by
// any site that hosts the generator (slopscore.org imports it). The page also needs generator.css (or the site's own
// styles), player/meter-core.js and generator.js, in that order, after this markup.
//
//   import { generatorBody } from './form.mjs';
//   generatorBody({ rubric, paths: { rubric, core, mp4, slops } })   // paths relative to the page; slops is optional
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ZONES = ['#6fae8c', '#a9c26a', '#e2c06a', '#e8669a', '#cc3f79', '#8a5a30'];

export function generatorBody({ rubric, paths }) {
  return `<section class="wrap page-head"><p class="kicker">free, no sign-up, nothing leaves your browser</p><h1>Make a slop-o-meter</h1>
<p class="lede">Log where the AI went in your video, song, game or app. Each line kicks the needle by its points; the score is out of 100, all the AI it could have used. Then share it: a link that shows the meter and sends people on to your work, or a video for your intro.</p></section>
<section class="wrap gen-shared" hidden><div class="panel"><p class="small">Somebody shared a slop-o-meter with you</p><h2></h2><p class="gen-shared-score"></p>
<p class="cta"><a class="btn gen-shared-go" rel="noopener nofollow ugc" target="_blank" hidden>Go to the work</a> <a class="btn ghost" href="#gen-form">Make your own</a></p></div></section>
<section class="wrap gen">
  <form class="gen-form" id="gen-form" autocomplete="off" data-rubric="${esc(paths.rubric)}" data-core="${esc(paths.core)}" data-mp4="${esc(paths.mp4)}"${paths.slops ? ` data-slops="${esc(paths.slops)}"` : ''}>
    <div class="g-top"><label>Title <input name="title" maxlength="40" value="My Video"></label>
    <label>Byline <input name="byline" maxlength="40" value="a music video"></label>
    <label class="g-url">Link to the work <small>(optional: where people can see it)</small><input name="url" type="url" maxlength="300" placeholder="https://youtu.be/... or your project's page" inputmode="url"></label></div>
    <fieldset class="g-rows"><legend>Where the AI went</legend>
    ${rubric.categories.map(c => `<div class="g-row" data-cat="${c.id}"><div class="g-name"><b>${esc(c.label)}</b><small>up to ${c.weight} pts</small></div>
      <div class="g-level" role="radiogroup" aria-label="${esc(c.label)}">${Object.entries(rubric.levels).sort((a, b) => a[0] - b[0]).map(([k, l]) => `<label><input type="radio" name="lv-${c.id}" value="${k}"${k === '0' ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
      <p class="g-hint">${esc(c.hint)}</p>
      <input class="g-text" name="tx-${c.id}" maxlength="52" placeholder="${esc(c.hint.split(':')[0].slice(0, 52))}"></div>`).join('')}
    </fieldset>
    <label class="g-hand">By hand <small>(comma-separated: what people did)</small><input name="human" maxlength="160" value="the idea, every note"></label>
  </form>
  <div class="gen-out">
    <div class="meter-box"><canvas class="meter gen-canvas" aria-label="Your slop-o-meter, live"></canvas>
    <div class="meter-ui"><button class="m-play" type="button">Play</button><input class="m-scrub" type="range" min="0" max="1000" value="1000" aria-label="Scrub"><label class="m-snd"><input type="checkbox" checked> sound</label></div></div>
    <p class="gen-score"></p>
    <div class="gen-actions">
      <button class="btn" data-act="share" type="button">Share</button>
      <button class="btn ghost" data-act="mp4" type="button">Download video (.mp4)</button>
    </div>
    <p class="small gen-status" role="status"></p>
  </div>
  <dialog class="share-dlg" aria-labelledby="share-h">
    <div class="share-head"><h2 id="share-h">Share your slop-o-meter</h2><button class="share-x" type="button" data-act="close" aria-label="Close">&times;</button></div>
    <p class="small">The link plays your meter, then points people to your work. Everything's in the link itself; nothing is stored on our side.</p>
    <div class="share-link"><input class="share-url" readonly aria-label="Link to your slop-o-meter"><button class="btn" data-act="link" type="button">Copy link</button></div>
    <div class="share-to">
      <button class="share-native" data-act="native" type="button" hidden>Share&hellip;</button>
      <a data-to="x" target="_blank" rel="noopener">X</a><a data-to="bsky" target="_blank" rel="noopener">Bluesky</a><a data-to="reddit" target="_blank" rel="noopener">Reddit</a>
      <a data-to="facebook" target="_blank" rel="noopener">Facebook</a><a data-to="linkedin" target="_blank" rel="noopener">LinkedIn</a><a data-to="email">Email</a>
    </div>
    <h3>Download</h3>
    <div class="share-grid">
      <button data-act="mp4" type="button"><b>Video</b><small>.mp4 with sound, for an intro</small></button>
      <button data-act="html" type="button"><b>Animation</b><small>.html, plays offline, for a web page</small></button>
      <button data-act="png" type="button"><b>Image</b><small>.png of the final frame</small></button>
      <button data-act="webm" type="button"><b>Recording</b><small>.webm, recorded in real time</small></button>
    </div>
    <h3>Copy</h3>
    <div class="share-grid">
      <button data-act="desc" type="button"><b>Description text</b><small>"where the AI went", for YouTube or a post</small></button>
      <button data-act="json" type="button"><b>JSON</b><small>for the slop-o-meter skill</small></button>
    </div>
    <p class="small gen-status" role="status"></p>
  </dialog>
</section>
<section class="wrap how" id="how"><h2>How the score works</h2>
<p>The most AI a piece of work can use is: AI wrote it, AI directed it, AI generated the picture, AI generated the sound. Those four weigh 15 each. Generated images and code come next, then the helpers (tracking, masks and depth maps, motion graphics, sound effects, research), and audio cleanup and mastering weigh least. Each use gets a level: a touch, half, mostly or all AI. Points are weight times level; the score is the sum.</p>
<table class="rubric"><thead><tr><th>Category</th><th>Weight</th><th>What counts</th></tr></thead><tbody>${rubric.categories.map(c => `<tr><td>${esc(c.label)}</td><td>${c.weight}</td><td>${esc(c.hint)}</td></tr>`).join('')}</tbody></table>
<p>Verdicts: ${rubric.verdicts.map(v => `<span class="verdict-tag" style="--z:${ZONES[rubric.verdicts.indexOf(v)]}">${v.min}+ ${esc(v.text)}</span>`).join(' ')}</p>
<p>Scale every level by how much of the finished piece that use covers. Overlays on a talk that's mostly your face don't make the talk mostly AI.</p></section>`;
}

// Build the standalone generator page: node generator/build.mjs  ->  generator/index.html
// Serve the skill folder (python -m http.server 5199) and open http://localhost:5199/generator/ : fetch() and the
// module imports don't work from file://. Rebuild after changing rubric.json or form.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatorBody } from './form.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rubric = JSON.parse(readFileSync(path.join(HERE, '..', 'rubric.json'), 'utf8'));
const body = generatorBody({ rubric, paths: { rubric: '../rubric.json', core: '../player/meter-core.js', mp4: './mp4-export.mjs' } });
writeFileSync(path.join(HERE, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Make a slop-o-meter</title>
<meta name="description" content="Log where AI went in your video, song, game or app, get a score out of 100 and an animated brass gauge to download.">
<link rel="stylesheet" href="generator.css">
</head><body>
<!-- built by generator/build.mjs from form.mjs and ../rubric.json: edit those, not this file -->
<main>
${body}
</main>
<p class="wrap foot">The slop-o-meter, from <a href="https://github.com/NTBooks/AIVCR">AIVCR</a>. Also at <a href="https://slopscore.org/slop-o-meter/">slopscore.org</a>.</p>
<script src="../player/meter-core.js"></script>
<script src="generator.js"></script>
</body></html>
`);
console.log('wrote', path.join(HERE, 'index.html'));

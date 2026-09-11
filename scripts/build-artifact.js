/* Bundles index.html + styles.css + app.js into one self-contained page.
   Used for hosting AppCull somewhere that serves a single file. There is no
   second copy of the markup or logic to keep in sync — this reads the real ones. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const js = read('app.js');

const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script src="app\.js"><\/script>/, '')
  .trim();

// The bundle is served as a single file, so there is no service worker or
// manifest to fetch; registration is guarded in app.js and simply no-ops.
const out = `<title>AppCull</title>
<style>
${css.trim()}
</style>

${body}

<script>
${js.trim()}
</script>
`;

const dest = process.argv[2] || path.join(ROOT, 'dist', 'appcull.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024).toFixed(1)} KB)`);

// Writes ui/modules/index.json — the list of module folders the UI loads.
// Runs automatically before `tauri dev` and `tauri build`.
// Folders starting with "_" (like _template) are skipped.

const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../ui/modules');
const ids = fs.readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .filter((d) => fs.existsSync(path.join(dir, d.name, 'index.js')))
  .map((d) => d.name)
  .sort();

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(ids, null, 2) + '\n');
console.log(`usagi: ${ids.length} module(s) → ${ids.join(', ')}`);

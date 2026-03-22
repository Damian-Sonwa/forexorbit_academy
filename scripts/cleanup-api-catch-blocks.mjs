import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'pages', 'api');

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) {
      let s = fs.readFileSync(p, 'utf8');
      const o = s;
      s = s.replace(
        new RegExp(
          String.raw`\n    console\.error\(([^)]+)\);\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    ` +
            String.raw`console\.error\(errorMessage\); res\.status\(500\)\.json\(`,
          'g'
        ),
        '\n    console.error($1);\n    res.status(500).json('
      );
      s = s.replace(
        new RegExp(
          String.raw`\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    console\.error\(([^,]+),\s*errorMessage\);\n    ` +
            String.raw`console\.error\(errorMessage\); res\.status\(500\)\.json\(`,
          'g'
        ),
        '\n    console.error($1, error);\n    res.status(500).json('
      );
      s = s.replace(
        new RegExp(
          String.raw`\n    console\.error\(([^)]+)\);\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    ` +
            String.raw`res\.status\(500\)\.json\(`,
          'g'
        ),
        '\n    console.error($1);\n    res.status(500).json('
      );
      s = s.replace(
        new RegExp(
          String.raw`\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    console\.error\(([^,]+),\s*errorMessage\);\n    ` +
            String.raw`res\.status\(500\)\.json\(`,
          'g'
        ),
        '\n    console.error($1, error);\n    res.status(500).json('
      );
      s = s.replace(
        new RegExp(
          String.raw`\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    console\.error\(errorMessage\); ` +
            String.raw`res\.status\(500\)\.json\(`,
          'g'
        ),
        "\n    console.error('API error:', error);\n    res.status(500).json("
      );
      s = s.replace(
        new RegExp(
          String.raw`\n    const errorMessage = error instanceof Error \? error\.message : [^;]+;\n    ` +
            String.raw`res\.status\(500\)\.json\(`,
          'g'
        ),
        "\n    console.error('API error:', error);\n    res.status(500).json("
      );
      if (s !== o) {
        fs.writeFileSync(p, s);
        console.log('patched', p);
      }
    }
  }
}

walk(root);

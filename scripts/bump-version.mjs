import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const filesToUpdate = [
  'package.json',
  'src/manifest.json',
  'src/manifest-firefox.json',
  'src/manifest-safari.json'
];

// Read package.json to get the current version
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Calculate new version (increment patch)
const parts = currentVersion.split('.');
const patch = parseInt(parts[2], 10);
const newVersion = `${parts[0]}.${parts[1]}.${patch + 1}`;

console.log(`Bumping version from ${currentVersion} to ${newVersion}...`);

filesToUpdate.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Regex to match exactly `"version": "x.y.z"`
    content = content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated ${file}`);
  } else {
    console.warn(`⚠ Could not find ${file}`);
  }
});

console.log('\nVersion bump complete! 🎉');

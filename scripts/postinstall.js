import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version;
const platform = os.platform();
const arch = os.arch();

// Determine libc for Linux
let libc = '';
if (platform === 'linux') {
  try {
    const report = process.report?.getReport?.();
    if (report && report.header && report.header.glibcVersionRuntime) {
      libc = 'gnu';
    } else {
      const ldd = execSync('ldd --version', { encoding: 'utf8' }).toLowerCase();
      libc = ldd.includes('musl') ? 'musl' : 'gnu';
    }
  } catch (e) {
    libc = 'gnu'; // fallback
  }
}

let filename = '';
if (platform === 'win32') {
  filename = `index.win32-${arch}-msvc.node`;
} else if (platform === 'darwin') {
  filename = `index.darwin-${arch}.node`;
} else if (platform === 'linux') {
  filename = `index.linux-${arch}-${libc}.node`;
} else {
  console.warn(`[postinstall] Unsupported platform/arch: ${platform}/${arch}`);
  process.exit(0);
}

const nativeDir = path.join(rootDir, 'native');
const targetFile = path.join(nativeDir, filename);

if (process.env.SKIP_POSTINSTALL === '1') {
  console.log(`[postinstall] SKIP_POSTINSTALL is set. Skipping download.`);
  process.exit(0);
}

// If the file already exists (e.g., local dev or compiled locally), skip downloading
if (fs.existsSync(targetFile)) {
  console.log(`[postinstall] Native binary ${filename} already exists. Skipping download.`);
  process.exit(0);
}

const url = `https://github.com/podgorniy/ts-md-msg/releases/download/v${version}/${filename}`;

console.log(`[postinstall] Downloading native binary from ${url}...`);

if (!fs.existsSync(nativeDir)) {
  fs.mkdirSync(nativeDir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        fs.unlink(dest, () => {});
        return reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

download(url, targetFile)
  .then(() => console.log(`[postinstall] Successfully downloaded ${filename}`))
  .catch(err => {
    console.error(`[postinstall] Error: Could not download pre-built binary. If you are developing locally, run 'npm run build:rust'. Error: ${err.message}`);
    process.exit(1);
  });

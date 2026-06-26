#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

console.log('Cleaning dist directory...');
let existingConfigJson = null;
const distConfigPath = path.join(distDir, 'config.json');
if (fs.existsSync(distConfigPath)) {
  existingConfigJson = fs.readFileSync(distConfigPath, 'utf8');
  console.log('Preserved existing config.json from dist');
}
if (fs.existsSync(distDir)) {
  fs.removeSync(distDir);
}

console.log('Building frontend...');
execSync('npx vite build', { cwd: rootDir, stdio: 'inherit' });

console.log('Copying static assets...');
if (fs.existsSync(publicDir)) {
  fs.copySync(publicDir, distDir, { overwrite: false });
  console.log('Copied all static assets');
}

if (existingConfigJson && !fs.existsSync(distConfigPath)) {
  fs.writeFileSync(distConfigPath, existingConfigJson, 'utf8');
  console.log('Restored existing config.json');
}

// 替换时间戳
console.log('Replacing timestamp in index.html...');
const indexHtmlPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  const timestamp = Date.now();
  let html = fs.readFileSync(indexHtmlPath, 'utf8');
  // 替换所有 ?t= 后面的数字为新的时间戳
  html = html.replace(/(\?t=)\d+/g, `$1${timestamp}`);
  fs.writeFileSync(indexHtmlPath, html, 'utf8');
  console.log(`Updated timestamp to ${timestamp}`);
}

// 重命名为 dashboard.html，避免 ASSETS 直接拦截首页
const dashboardHtmlPath = path.join(distDir, 'dashboard.html');
if (fs.existsSync(indexHtmlPath)) {
  fs.renameSync(indexHtmlPath, dashboardHtmlPath);
  console.log('Renamed index.html → dashboard.html');
}

console.log('Build complete!');

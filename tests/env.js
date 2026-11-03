/* Where the tests find the site and Chrome. Set CHROME_PATH or SITE_URL to change them. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
module.exports = {
  root, shots,
  js: path.join(root, 'js') + path.sep,
  site: process.env.SITE_URL || 'file:///' + path.join(root, 'index.html').split(path.sep).join('/').replace(/ /g, '%20'),
  launch: { executablePath: chrome, headless: 'new', args: process.env.CI ? ['--no-sandbox'] : [] },
};

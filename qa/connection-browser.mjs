// 실제 Apps Script와 브라우저 CORS를 확인하는 읽기 전용 검사.
// 입력·교사 암호·모둠 제출 없이 실행하며 모든 POST를 차단합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const site = process.env.CLASSROOM_CONNECTION_URL || 'http://127.0.0.1:4173/';
assert.ok(['http://127.0.0.1:4173','https://blink-24.github.io'].includes(new URL(site).origin));
const output = new URL('../artifacts/lesson4-browser/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CLASSROOM_BROWSER_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const blockedPosts = [], errors = [];
await context.route('**/*', route => {
  if (route.request().method() === 'POST') { blockedPosts.push(new URL(route.request().url()).hostname); return route.abort('blockedbyclient'); }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(35000);
try {
  await page.goto(site, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('chaeum:v5:public-config') || '{}').implementedLessons?.includes(4); } catch { return false; }
  });
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('chaeum:v5:public-config')));
  assert.ok(['5.1.0', '5.2.0', '5.3.0'].includes(config.appVersion)); assert.equal(config.l4AiEnabled, false);
  assert.equal(config.l4ScriptVersion, config.appVersion .startsWith('5.2.') || config.appVersion.startsWith('5.3.') ? '1.1.0' : '1.0.0');
  assert.equal(await page.locator('[data-action="learn-slide"]').count(), config.acceptLessons.includes(2) ? 18 : 0);
  await page.locator('#lesson-tab-4').click();
  if (config.acceptLessons.includes(4)) await page.locator('form[data-form="l4-entry"]').waitFor();
  else { await page.locator('[data-lesson-locked="4"]').waitFor(); assert.match(await page.locator('[data-lesson-locked="4"]').innerText(), /지금 닫혀/); }
  assert.equal(blockedPosts.length, 0); assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('real-api-read-only.png', output).pathname, fullPage: true });
  const report = { site, realApi: true, readOnly: true, createdRecords: 0, blockedPosts, errors, version: config.appVersion, scriptVersion: config.l4ScriptVersion, classCount: config.classCount, acceptLessons: config.acceptLessons, l4AiEnabled: config.l4AiEnabled };
  await fs.writeFile(new URL('real-api-read-only.json', output), JSON.stringify(report, null, 2));
  console.log(`PASS: 실제 서버${config.appVersion}·대본${config.l4ScriptVersion} 브라우저 CORS·2/4차시 화면(읽기 전용, 저장 없음)`);
} finally { await context.close(); await browser.close(); }

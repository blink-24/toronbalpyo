import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const site = 'http://127.0.0.1:4173/';
const api = 'http://127.0.0.1:4180/exec';
const output = new URL('../artifacts/lesson4-browser/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const report = { syntheticOnly: true, storage: 'in-memory fixture; no Google writes', cases: [], startedAt: new Date().toISOString() };
const browser = await chromium.launch();
async function call(action, payload = {}, method = 'POST') {
  const url = new URL(api); if (method === 'GET') for (const [key, value] of Object.entries({ ...payload, action })) url.searchParams.set(key, value);
  return (await fetch(url, method === 'POST' ? { method, body: JSON.stringify({ ...payload, action }) } : {})).json();
}
async function inspect(page, name) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(layout.scroll <= layout.width + 2, `${name}: overflow ${layout.scroll}/${layout.width}`);
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname, fullPage: true });
}
async function state(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}')); }
async function stage(page, value) {
  await page.waitForFunction(expected => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}').lesson4?.stage === expected, value);
  await page.waitForFunction(() => !document.querySelector('.busy-note'));
}
async function context(options = {}) {
  const ctx = await browser.newContext(options);
  ctx.apiOffline = false;
  await ctx.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(site).origin) return route.continue();
    // Never send fixture teacher credentials or synthetic answers to production.
    if (url.hostname === 'script.google.com') {
      if (ctx.apiOffline) return route.abort('internetdisconnected');
      const response = await route.fetch({ url: api + url.search });
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    }
    return route.abort('blockedbyclient');
  });
  return ctx;
}
let teacherContext;
try {
  teacherContext = await context({ viewport: { width: 1440, height: 1000 } });
  const teacher = await teacherContext.newPage(); teacher.setDefaultTimeout(35000);
  await teacher.goto(site, { waitUntil: 'networkidle' });
  await teacher.locator('#lesson-tab-4').click();
  assert.equal(await teacher.locator('form[data-form="l4-entry"]').count(), 0, 'initial L4 must be closed');
  await teacher.locator('[data-action="teacher"]').click();
  await teacher.locator('#teacher-class').selectOption('11');
  await teacher.locator('#teacher-passcode').fill('fixture-teacher-only');
  await teacher.locator('form[data-form="teacher-login"] button[type="submit"]').click();
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').waitFor();
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="4"]')?.textContent.includes('닫기'));
  assert.deepEqual((await call('config', {}, 'GET')).data.acceptLessons, [2, 4]);
  assert.equal((await call('set_lessons', { acceptLessons: [] })).error.code, 'UNAUTHORIZED');
  await inspect(teacher, 'teacher-controls');
  report.cases.push({ name: 'teacher open L4, unauthorized write denied', status: 'passed' });

  for (const options of [
    { name: 'desktop-four', viewport: { width: 1440, height: 1000 }, mobile: false, early: false, offline: false, stance: '찬성' },
    { name: 'mobile-early-offline', viewport: { width: 390, height: 844 }, mobile: true, early: true, offline: true, stance: '반대' }
  ]) {
    const record = { name: options.name, status: 'running', pageErrors: [] }; report.cases.push(record);
    const ctx = await context({ viewport: options.viewport, isMobile: options.mobile, hasTouch: options.mobile, acceptDownloads: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(35000);
    page.on('pageerror', error => record.pageErrors.push(error.message));
    try {
      await page.goto(site, { waitUntil: 'networkidle' });
      await page.locator('#tab-learn').waitFor();
      assert.equal(await page.locator('[data-action="learn-slide"]').count(), 19);
      await page.locator('#lesson-tab-4').click();
      await page.locator('#l4-representative').fill('21199');
      await page.locator('#l4-group-name').fill(`검토용 ${options.name}`);
      for (let n = 1; n <= 4; n++) await page.locator(`#l4-member-${n}`).fill(`211${95 + n}`);
      await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
      assert.equal(await page.locator('#l4-group-name').inputValue(), `검토용 ${options.name}`);
      await inspect(page, `${options.name}-entry`);
      await page.locator('#l4-entry-submit').click(); await stage(page, 'argument');
      await page.locator(`[data-action="l4-stance"][data-value="${options.stance}"]`).click();
      const argument = options.stance === '찬성'
        ? '공공 의료 상담을 도입하면 의료 소외 지역 주민의 접근성을 높일 수 있습니다. 다만 전화와 보건소 지원, 의료진 연계와 책임 범위를 함께 마련해야 합니다.'
        : '공공 의료 상담의 확대 전에는 개인정보 보호와 오류의 책임 범위를 분명하게 마련해야 합니다. 고령 주민에게도 실제 도움이 되는지 별도 검증이 필요합니다.';
      await page.locator('#l4-arg1').fill(argument);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('#l4-arg1').inputValue(), argument, 'argument draft survives reload');
      await page.locator('[data-action="l4-start"]').click(); await stage(page, 'dialogue');
      for (let turn = 1; turn <= (options.early ? 3 : 4); turn++) {
        assert.equal((await state(page)).lesson4.turn, turn);
        assert.ok((await page.locator('.l4-help-cards .evidence-card').count()) >= 2);
        assert.equal(await page.locator('.criterion-badge').count(), 0, 'no criteria before feedback');
        await page.locator('#l4-answer').fill('한계는 인정합니다. 다만 의료 상담 도입 여부는 자료의 출처와 검증 범위, 공공 의료 접근성과 책임 배분을 함께 확인해야 하므로 범위를 제한해 보완하겠습니다.');
        await page.locator('[data-action="l4-cite"]').first().click();
        if (turn === 1) await inspect(page, `${options.name}-dialogue`);
        await page.locator('[data-action="l4-answer-next"]').click();
        await stage(page, !options.early && turn === 4 ? 'feedback' : 'dialogue');
      }
      if (options.early) { await page.locator('[data-action="l4-early-feedback"]').click(); await stage(page, 'feedback'); }
      await inspect(page, `${options.name}-feedback`);
      await page.locator('#l4-reflection').fill('다음에는 출처의 구체성과 정책의 적용 범위를 먼저 확인하겠습니다.');
      if (options.offline) ctx.apiOffline = true;
      await page.locator('[data-action="l4-submit"]').click(); await stage(page, 'complete');
      if (options.offline) {
        assert.equal((await state(page)).lesson4.status, 'pending');
        ctx.apiOffline = false; await page.locator('[data-action="l4-retry"]').click();
      }
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}').lesson4?.status === 'sent');
      const download = page.waitForEvent('download'); await page.locator('[data-action="l4-download"]').click();
      assert.match((await download).suggestedFilename(), /^4차시_.*\.txt$/);
      await inspect(page, `${options.name}-complete`);
      const saved = (await (await fetch('http://127.0.0.1:4180/qa/state')).json()).l4_sessions.filter(row => row.groupName === `검토용 ${options.name}`);
      assert.equal(saved.length, 1); assert.equal(Number(saved[0].completedQuestionCount), options.early ? 3 : 4);
      assert.equal(JSON.parse(saved[0].memberStudentIds).length, 4);
      const anonymous = await call('public_summary', { lesson: 4 }, 'GET');
      assert.equal(anonymous.ok, true); assert.doesNotMatch(JSON.stringify(anonymous), /21199|groupName|memberStudentIds|arg1|reflection/);
      assert.equal(record.pageErrors.length, 0); record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = error.message; await inspect(page, `${options.name}-failure`); throw error; }
    finally { await ctx.close(); }
  }
  await teacher.locator('#teacher-lesson').selectOption('4');
  await teacher.locator('[data-action="teacher-refresh"]').click();
  await teacher.getByText('검토용 desktop-four', { exact: true }).first().waitFor();
  await inspect(teacher, 'teacher-group-results');
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="2"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="2"]')?.textContent.includes('열기'));
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="4"]')?.textContent.includes('열기'));
  assert.deepEqual((await call('config', {}, 'GET')).data.acceptLessons, []);
  assert.equal((await call('progress', { lesson: 2, studentId: '21199' })).error.code, 'LESSON_CLOSED');
  assert.equal((await call('progress', { lesson: 4, studentId: '21199' })).error.code, 'LESSON_CLOSED');
  const closedContext = await context(); const closed = await closedContext.newPage();
  await closed.goto(site, { waitUntil: 'networkidle' });
  assert.equal(await closed.locator('[data-action="learn-slide"]').count(), 0, 'L2 learning also gated');
  await closed.locator('#lesson-tab-4').click();
  assert.equal(await closed.locator('form[data-form="l4-entry"]').count(), 0);
  await inspect(closed, 'both-lessons-closed'); await closedContext.close();
  report.cases.push({ name: 'teacher group results and both closed on client/server', status: 'passed' });
} finally {
  report.completedAt = new Date().toISOString();
  await fs.writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await teacherContext?.close(); await browser.close();
}
assert.ok(report.cases.every(item => item.status === 'passed'));
console.log('PASS: two lesson browser checks; no Google writes or AI calls');

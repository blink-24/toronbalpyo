import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const site = 'http://127.0.0.1:4173/';
const api = 'http://127.0.0.1:4180/exec';
const output = new URL('../artifacts/lesson4-browser/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const report = { syntheticOnly: true, storage: 'in-memory fixture; no Google writes', cases: [], startedAt: new Date().toISOString() };
const browser = await chromium.launch({ channel: process.env.CLASSROOM_BROWSER_CHANNEL || undefined });
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
      if (ctx.legacyScripts && url.searchParams.get('action') === 'config') {
        const body = await response.json(); delete body.data.l4ScriptVersion; body.data.appVersion = '5.1.0';
        return route.fulfill({ response, body: JSON.stringify(body), headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
      }
      if (ctx.oldServer && url.searchParams.get('action') === 'config') {
        const body = await response.json(); delete body.data.implementedLessons;
        delete body.data.l4AiEnabled; body.data.appVersion = '5.0.0';
        return route.fulfill({ response, body: JSON.stringify(body), headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
      }
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
  assert.equal(await teacher.locator('#teacher-class option').count(), 13);
  await teacher.locator('#teacher-class').selectOption('11');
  await teacher.locator('#teacher-passcode').fill('fixture-teacher-only');
  await teacher.locator('form[data-form="teacher-login"] button[type="submit"]').click();
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').waitFor();
  assert.equal(await teacher.locator('#teacher-filter option').count(), 13);
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="4"]')?.textContent.includes('닫기'));
  assert.deepEqual((await call('config', {}, 'GET')).data.acceptLessons, [2, 4]);
  assert.equal((await call('set_lessons', { acceptLessons: [] })).error.code, 'UNAUTHORIZED');
  await inspect(teacher, 'teacher-controls');
  report.cases.push({ name: 'teacher open L4, unauthorized write denied', status: 'passed' });

  const l2Context = await context({ viewport: { width: 1280, height: 900 } });
  const l2 = await l2Context.newPage(); l2.setDefaultTimeout(35000);
  const waitL2 = async expected => {
    await l2.waitForFunction(value => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}').activity?.step === value, expected);
    await l2.waitForFunction(() => !document.querySelector('.busy-note'));
  };
  await l2.goto(site, { waitUntil: 'networkidle' }); await l2.locator('#tab-activity').click();
  await l2.locator('#student-id').fill('21195'); await l2.locator('form[data-form="login"] button[type="submit"]').click();
  await waitL2('stance'); await l2.locator('[data-action="stance"][data-value="반대"]').click();
  await l2.locator('[data-action="next"]').click(); await waitL2('reason');
  await l2.locator('[data-action="reason"][data-id="RN2"]').click(); await l2.locator('[data-action="next"]').click(); await waitL2('evidence');
  await l2.locator('[data-action="card"][data-id="ND"]').click(); await l2.locator('[data-action="next"]').click(); await waitL2('argument');
  const editedArgument = ((await l2.locator('#arg-text').inputValue()) + '\n적용 범위를 더 살피겠습니다.').slice(0, 300);
  await l2.locator('#arg-text').fill(editedArgument);
  const originalL2 = (await state(l2)).activity.sessionId;
  await l2.locator('[data-action="student-logout"]').click();
  await l2.locator('#student-id').waitFor(); assert.equal((await state(l2)).studentId, '');
  await l2.reload({ waitUntil: 'networkidle' }); await l2.locator('#student-id').waitFor();
  await l2.locator('#student-id').fill('21194'); await l2.locator('form[data-form="login"] button[type="submit"]').click(); await waitL2('stance');
  assert.equal((await state(l2)).activity.argText, '');
  await l2.locator('[data-action="student-logout"]').click();
  await l2.locator('#student-id').fill('21195'); await l2.locator('form[data-form="login"] button[type="submit"]').click(); await waitL2('argument');
  assert.equal(await l2.locator('#arg-text').inputValue(), editedArgument); assert.equal((await state(l2)).activity.sessionId, originalL2);
  await l2.locator('[data-action="next"]').click(); await waitL2('dialogue');
  assert.match(await l2.locator('.chat-person').innerText(), /찬성측 토론자/);
  for (let turn = 1; turn <= 3; turn++) {
    await l2.locator('#answer-text').fill('한계는 인정합니다. 다만 보행 중 스마트폰 정책은 자료의 출처와 시기, 다른 원인을 함께 확인해서 주장 범위를 제한하고 근거를 보완하겠습니다.');
    await l2.locator('[data-action="cite"]').first().click();
    await l2.locator('[data-action="commit-answer"]').click(); await waitL2(turn === 3 ? 'feedback' : 'dialogue');
    if (turn === 1) {
      await l2.locator('#answer-text').fill('두 번째 질문에서 작성 중이던 답변입니다.');
      await inspect(l2, 'student-logout-button');
      await l2.locator('[data-action="student-logout"]').click();
      await l2.locator('#student-id').fill('21195'); await l2.locator('form[data-form="login"] button[type="submit"]').click(); await waitL2('dialogue');
      assert.equal((await state(l2)).activity.turn, 2); assert.equal((await state(l2)).activity.committedAnswers.length, 1);
      assert.equal(await l2.locator('#answer-text').inputValue(), '두 번째 질문에서 작성 중이던 답변입니다.');
      assert.equal(await l2.locator('#toast').innerText(), '입장했어요.');
    }
  }
  await l2.locator('#reflection-text').fill('다음에는 자료의 출처와 정책의 적용 범위를 함께 확인하겠습니다.');
  await l2.locator('[data-action="submit"]').click(); await waitL2('complete');
  await l2.waitForFunction(() => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}').activity?.status === 'sent');
  await inspect(l2, 'lesson2-existing-complete'); await l2Context.close();
  report.cases.push({ name: 'existing L2 three answers, opposing role, saved once', status: 'passed' });

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
      assert.equal((await state(page)).lesson4.session.version, '1.1.0');
      assert.ok((await state(page)).lesson4.session.plan.some(q => q.id.startsWith('L4K-')));
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
        const submissionId = (await state(page)).lesson4.submissionId;
        await page.locator('[data-action="student-logout"]').click(); await page.locator('#l4-representative').waitFor();
        assert.equal(await page.locator('#l4-group-name').inputValue(), '');
        await inspect(page, 'group-signed-out-mobile');
        await page.locator('#l4-representative').fill('21199'); await page.locator('#l4-group-name').fill(`검토용 ${options.name}`);
        for (let n = 1; n <= 4; n++) await page.locator(`#l4-member-${n}`).fill(`211${95 + n}`);
        await page.locator('#l4-entry-submit').click(); await stage(page, 'complete');
        assert.equal(await page.locator('#toast').innerText(), '모둠 활동에 입장했어요.');
        assert.equal((await state(page)).lesson4.submissionId, submissionId); assert.equal((await state(page)).lesson4.status, 'pending');
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
  await teacher.locator('[data-action="teacher-record"]').first().click();
  assert.match(await teacher.locator('[role="dialog"]').innerText(), /21196, 21197, 21198, 21199/);
  assert.equal(await teacher.locator('[data-action="project-answer"]').count(), 4);
  await teacher.locator('[data-action="project-answer"]').first().click();
  assert.doesNotMatch(await teacher.locator('[role="dialog"]').innerText(), /2119[6-9]|검토용/);
  await teacher.locator('[data-action="close-dialog"]').first().click();
  const watchingContext = await context(); const watching = await watchingContext.newPage();
  watching.setDefaultTimeout(25000);
  await watching.goto(site + '#/lesson4', { waitUntil: 'networkidle' });
  await watching.locator('#l4-group-name').fill('닫힘 중 보존할 초안');
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="2"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="2"]')?.textContent.includes('열기'));
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').click();
  await teacher.waitForFunction(() => document.querySelector('[data-action="toggle-lesson"][data-lesson="4"]')?.textContent.includes('열기'));
  assert.deepEqual((await call('config', {}, 'GET')).data.acceptLessons, []);
  assert.equal((await call('progress', { lesson: 2, studentId: '21199' })).error.code, 'LESSON_CLOSED');
  assert.equal((await call('progress', { lesson: 4, studentId: '21199' })).error.code, 'LESSON_CLOSED');
  await watching.locator('[data-lesson-locked="4"]').waitFor();
  assert.equal((await state(watching)).lesson4.groupName, '닫힘 중 보존할 초안');
  const closedContext = await context(); const closed = await closedContext.newPage();
  await closed.goto(site, { waitUntil: 'networkidle' });
  assert.equal(await closed.locator('[data-action="learn-slide"]').count(), 0, 'L2 learning also gated');
  await closed.locator('#lesson-tab-4').click();
  assert.equal(await closed.locator('form[data-form="l4-entry"]').count(), 0);
  await inspect(closed, 'both-lessons-closed'); await closedContext.close();
  await teacher.locator('[data-action="toggle-lesson"][data-lesson="4"]').click();
  await watching.locator('#l4-group-name').waitFor();
  assert.equal(await watching.locator('#l4-group-name').inputValue(), '닫힘 중 보존할 초안');
  await inspect(watching, 'reopened-draft-preserved'); await watchingContext.close();
  report.cases.push({ name: 'teacher group results and both closed on client/server', status: 'passed' });
  await call('set_lessons', { passcode: 'fixture-teacher-only', acceptLessons: [2,4] });
  const migrationContext = await context(); migrationContext.legacyScripts = true;
  const migration = await migrationContext.newPage(); migration.setDefaultTimeout(35000);
  await migration.goto(site + '#/lesson4', { waitUntil: 'networkidle' });
  await migration.locator('#l4-representative').fill('21199');
  await migration.locator('#l4-group-name').fill('버전 전환 검토');
  for (let n = 1; n <= 4; n++) await migration.locator(`#l4-member-${n}`).fill(`211${95 + n}`);
  await migration.locator('#l4-entry-submit').click(); await stage(migration, 'argument');
  await migration.locator('[data-action="l4-stance"][data-value="찬성"]').click();
  await migration.locator('#l4-arg1').fill('공공 의료 상담 도우미는 정확도와 개인정보 보호 조건을 확인한 뒤 도입 여부를 판단해야 합니다.');
  await migration.locator('[data-action="l4-start"]').click(); await stage(migration, 'dialogue');
  const legacyPlan = (await state(migration)).lesson4.session.plan;
  assert.equal((await state(migration)).lesson4.session.version, '1.0.0');
  migrationContext.legacyScripts = false;
  await migration.reload({ waitUntil: 'networkidle' }); await stage(migration, 'dialogue');
  await migration.locator('#l4-answer').fill('자료의 한계를 인정합니다. 다만 의료 상담의 출처와 적용 조건을 확인해야 하기 때문에 근거의 범위를 구분하겠습니다.');
  await migration.locator('[data-action="l4-answer-next"]').click(); await stage(migration, 'dialogue');
  assert.equal((await state(migration)).lesson4.turn, 2);
  assert.equal((await state(migration)).lesson4.session.version, '1.0.0');
  assert.deepEqual((await state(migration)).lesson4.session.plan, legacyPlan);
  await inspect(migration, 'script-version-resume'); await migrationContext.close();
  report.cases.push({ name: 'server capability rollout preserves existing script plan and answers', status: 'passed' });
  const legacyContext = await context(); legacyContext.oldServer = true;
  const legacy = await legacyContext.newPage();
  await legacy.goto(site, { waitUntil: 'networkidle' });
  assert.equal(await legacy.locator('[data-action="learn-slide"]').count(), 19);
  await legacy.locator('#lesson-tab-4').click();
  await legacy.getByText('4차시를 준비하고 있어요.', { exact: true }).waitFor();
  assert.equal(await legacy.locator('form[data-form="l4-entry"]').count(), 0);
  await inspect(legacy, 'original-server-compatibility'); await legacyContext.close();
  report.cases.push({ name: 'original server keeps L2, L4 preparing', status: 'passed' });
} finally {
  report.completedAt = new Date().toISOString();
  await fs.writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await teacherContext?.close(); await browser.close();
}
assert.ok(report.cases.every(item => item.status === 'passed'));
console.log('PASS: two lesson browser checks; no Google writes or AI calls');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const site = process.env.CLASSROOM_AUDIT_URL || 'https://blink-24.github.io/toronbalpyo/';
assert.ok(['https://blink-24.github.io', 'http://127.0.0.1:4173'].includes(new URL(site).origin));
const output = new URL('../artifacts/browser-audit/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const report = { site, startedAt: new Date().toISOString(), studentId: '21199', syntheticOnly: true, cases: [], created: [] };
const browser = await chromium.launch();

async function inspect(page, label) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(layout.scroll <= layout.width + 2, `${label}: horizontal overflow ${layout.scroll}/${layout.width}`);
  await page.screenshot({ path: new URL(`${label}.png`, output).pathname, fullPage: true });
}
async function state(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('chaeum:v5:state'))); }
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('.busy-note') && !document.querySelector('[data-action="next"]:disabled, [data-action="commit-answer"]:disabled, [data-action="submit"]:disabled'), undefined, { timeout: 35000 });
}
async function waitStep(page, step) {
  await page.waitForFunction(value => JSON.parse(localStorage.getItem('chaeum:v5:state') || '{}').activity?.step === value, step, { timeout: 35000 });
}
async function runFlow(options) {
  const result = { name: options.name, steps: [], pageErrors: [], status: 'running' };
  report.cases.push(result);
  const context = await browser.newContext({ viewport: options.viewport, isMobile: options.mobile, hasTouch: options.mobile });
  if (new URL(site).hostname === '127.0.0.1') {
    await context.addInitScript(() => localStorage.setItem('chaeum:public-endpoint', 'https://example.invalid/collector'));
  }
  const page = await context.newPage();
  page.setDefaultTimeout(35000);
  const submissions = [];
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().startsWith('https://script.google.com/')) return;
    try { const payload = JSON.parse(request.postData()); if (payload.action === 'submit') submissions.push(payload); } catch {}
  });
  const step = async (name, fn) => { console.log(`CHECK ${options.name}: ${name}`); await fn(); result.steps.push(name); };
  try {
    await step('open both tabs and learning content', async () => {
      await page.goto(site, { waitUntil: 'networkidle' });
      await page.locator('#tab-learn').waitFor();
      assert.equal(await page.locator('[role="tab"]').count(), 2);
      assert.equal(await page.locator('[data-action="learn-slide"]').count(), 19);
      await inspect(page, `${options.name}-learning`);
      if (!options.mobile) {
        for (const index of [4, 13, 15]) {
          await page.locator(`[data-action="learn-slide"][data-index="${index}"]`).click();
          await inspect(page, `${options.name}-learning-${index + 1}`);
        }
        assert.equal(await page.locator('.sample-pair .sample-row').count(), 3);
      } else {
        await page.locator('#mobile-lesson').selectOption('15');
        await inspect(page, `${options.name}-learning-16`);
      }
    });
    await step('synthetic student entry and stance', async () => {
      await page.locator('#tab-activity').click();
      await page.locator('#student-id').fill('21199');
      await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
      assert.equal(await page.locator('#student-id').inputValue(), '21199', 'entry draft disappeared after asynchronous render');
      await page.locator('form[data-form="login"] button[type="submit"]').click();
      await waitStep(page, 'stance');
      await page.locator(`[data-action="stance"][data-value="${options.stance}"]`).click();
      await page.locator('[data-action="next"]').click();
      await waitStep(page, 'reason');
      const current = await state(page);
      report.created.push({ name: options.name, sessionId: current.activity.sessionId, submissionId: current.activity.submissionId });
      result.sessionId = current.activity.sessionId;
      result.submissionId = current.activity.submissionId;
    });
    await step('reason, draft restoration, evidence and argument', async () => {
      await page.locator(`[data-action="reason"][data-id="${options.reasonId}"]`).click();
      const before = await state(page);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await state(page)).activity.reasonId, before.activity.reasonId);
      assert.equal((await state(page)).activity.sessionId, before.activity.sessionId);
      await page.locator('[data-action="next"]').click();
      await waitStep(page, 'evidence');
      assert.equal(await page.locator('.evidence-card').count(), 4);
      assert.equal(await page.locator('.virtual-strip').count(), 4);
      await page.locator(`[data-action="card"][data-id="${options.cardId}"]`).click();
      await inspect(page, `${options.name}-evidence`);
      await page.locator('[data-action="next"]').click();
      await waitStep(page, 'argument');
      assert.ok((await page.locator('#arg-text').inputValue()).length <= 300);
      const edited = (await page.locator('#arg-text').inputValue()) + '\n공동체의 안전도 함께 살피겠습니다.';
      await page.locator('#arg-text').fill(edited);
      await page.locator('[data-action="previous"]').click();
      await page.locator(`[data-action="card"][data-id="${options.cardId}"]`).click();
      await page.locator('[data-action="next"]').click();
      assert.equal(await page.locator('#arg-text').inputValue(), edited, 'edited argument disappeared after revisiting the same card');
      if (options.offline) await context.setOffline(true);
      await page.locator('[data-action="next"]').click();
      await waitStep(page, 'dialogue');
      await idle(page);
      const current = await state(page);
      assert.equal(current.activity.mode, options.offline ? 'script-local' : 'script');
      if (!options.offline) assert.ok(current.activity.remoteQuestions[1], 'real browser API question was not received');
    });
    await step('answer questions with help citations', async () => {
      const count = options.early ? 2 : 3;
      for (let turn = 1; turn <= count; turn++) {
        await idle(page);
        assert.equal((await state(page)).activity.turn, turn);
        assert.equal(await page.locator('.help-cards .evidence-card').count(), 2);
        assert.equal(await page.locator('.criterion-badge').count(), 0);
        if (turn === 1) await inspect(page, `${options.name}-question`);
        await page.locator('[data-action="cite"]').first().click();
        const citation = await page.locator('#answer-text').inputValue();
        assert.match(citation, /\[자료 H\d+\]/);
        await page.locator('#answer-text').fill(`${citation} 맞습니다. 이 자료에는 한계가 있습니다. 다만 자료와 주장 사이의 연결을 살펴야 하기 때문에 다른 원인과 공동체의 안전도 함께 고려하겠습니다.`);
        await page.locator('[data-action="commit-answer"]').click();
        await idle(page);
      }
      if (options.early) await page.locator('[data-action="early-feedback"]').click();
      await waitStep(page, 'feedback');
      await idle(page);
      assert.equal(await page.locator('.feedback-item').count(), count);
      const current = await state(page);
      assert.equal(current.activity.session.answers.length, count);
      assert.equal(new Set(current.activity.feedback.items.map(x => x.criterion)).size, count);
      await inspect(page, `${options.name}-feedback`);
    });
    await step('submit and confirm actual acknowledgement', async () => {
      await page.locator('#reflection-text').fill('자체 점검용 가상 활동입니다. 다음 입론에서는 자료의 출처와 이유의 연결을 함께 살피겠습니다.');
      await page.locator('[data-action="submit"]').click();
      await waitStep(page, 'complete');
      if (options.offline) {
        assert.equal((await state(page)).activity.status, 'pending');
        assert.ok((await page.locator('.status-banner').innerText()).includes('전송 대기'));
        const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('chaeum:v5:submission-queue')));
        assert.equal(pending.length, 1);
        await inspect(page, `${options.name}-offline-pending`);
        await context.setOffline(false);
        await page.locator('[data-action="retry-submit"]').click();
      }
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('chaeum:v5:state')).activity.status === 'sent', undefined, { timeout: 90000 });
      assert.ok((await page.locator('.status-banner').innerText()).includes('선생님께 전달'));
      assert.ok(submissions.length >= 1, 'browser did not send a real submit request');
      const payload = submissions[0];
      assert.equal(payload.submissionId, result.submissionId);
      result.actualAnswerCount = payload.data.answers.length;
      result.mode = payload.data.mode;
      await inspect(page, `${options.name}-complete`);
      const endpoint = await page.evaluate(() => window.CLASSROOM_CONFIG.apiUrl);
      const duplicate = await page.evaluate(async ({ endpoint, payload }) => {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
        return response.json();
      }, { endpoint, payload });
      assert.equal(duplicate.ok, true);
      assert.equal(duplicate.data.accepted, true);
      assert.equal(duplicate.data.duplicate, true);
      result.duplicateAcknowledged = true;
    });
    await step('anonymous sharing and teacher access rejection', async () => {
      await page.locator('[data-action="share"]').first().click();
      await page.locator('.share-grid').waitFor({ state: 'visible', timeout: 35000 });
      await inspect(page, `${options.name}-sharing`);
      const endpoint = await page.evaluate(() => window.CLASSROOM_CONFIG.apiUrl);
      const shared = await page.evaluate(async endpoint => (await fetch(endpoint + '?action=public_summary&cls=11')).json(), endpoint);
      assert.equal(shared.ok, true);
      assert.ok(shared.data.completed >= 1);
      for (const key of ['records','answers','studentId','sessionId','reflection']) assert.ok(!(key in shared.data));
      await page.locator('[data-action="teacher"]').click();
      await page.locator('form[data-form="teacher-login"]').waitFor();
      assert.equal(await page.locator('[data-action="connect-endpoint"]').count(), 0, 'public endpoint editor must not be exposed');
      const denied = await page.evaluate(async endpoint => (await fetch(endpoint + '?action=l2_summary')).json(), endpoint);
      assert.equal(denied.ok, false);
      assert.equal(denied.error.code, 'UNAUTHORIZED');
      assert.equal(result.pageErrors.length, 0, result.pageErrors.join('; '));
    });
    result.status = 'passed';
    console.log(`PASS ${options.name}: real browser activity, acknowledgement, duplicate protection and anonymous sharing`);
  } catch (error) {
    result.status = 'failed'; result.error = error.stack;
    console.log(`FAIL ${options.name}: ${error.message}`);
    try { result.lastState = await state(page); await page.screenshot({ path: new URL(`${options.name}-failure.png`, output).pathname, fullPage: true }); } catch {}
  } finally { await context.close(); }
}
try {
  await runFlow({ name: 'desktop-three', viewport: { width: 1440, height: 1000 }, mobile: false, stance: '찬성', reasonId: 'RP1', cardId: 'PA', early: false, offline: false });
  await runFlow({ name: 'mobile-offline-early', viewport: { width: 390, height: 844 }, mobile: true, stance: '반대', reasonId: 'RN2', cardId: 'ND', early: true, offline: true });
} finally {
  report.completedAt = new Date().toISOString();
  await fs.writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await browser.close();
}
assert.ok(report.cases.every(x => x.status === 'passed'), 'Browser audit failed; inspect the synthetic-only report artifact.');

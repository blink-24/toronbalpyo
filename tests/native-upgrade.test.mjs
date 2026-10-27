import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { HEADERS } from '../backend/service.js';
import { createLesson4Engine } from '../src/core/lesson4.js';
import lesson4Content from '../src/core/lesson4-content.js';

const source = await fs.readFile(new URL('../backend/ServerBundle.gs', import.meta.url), 'utf8');
function sheetFixture(rows, columns = rows[0].length) {
  const data = structuredClone(rows), additions = [];
  return { data, additions,
    getName: () => 'config', getMaxColumns: () => columns,
    getLastColumn: () => data[0].length,
    insertColumnsAfter: (after, count) => { assert.equal(after, columns); additions.push(count); columns += count; },
    getDataRange: () => ({ getValues: () => structuredClone(data) }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
      setValues: values => { assert.ok(c - 1 + nc <= columns); values.forEach((row, i) => row.forEach((value, j) => { data[r - 1 + i] ||= []; data[r - 1 + i][c - 1 + j] = value; })); },
      setValue: value => { data[r - 1][c - 1] = value; }
    }),
    appendRow: row => data.push([...row]), setFrozenRows() {}
  };
}
function sandboxFor(config) {
  const box = { PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SPREADSHEET_ID' ? 'fixture-db' : null }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => ({ getSheetByName: () => config }) }, LockService: {} };
  vm.createContext(box); vm.runInContext(source, box); return box;
}
test('GAS 머리글은 28→39열로 확장하면서 기존 헤더·행을 그대로 보존한다', () => {
  const old = HEADERS.l4_sessions.slice(0, 28), sheet = sheetFixture([old, ['기존 행', '수정 금지']], 28), box = sandboxFor(sheet);
  box.classroomHeaders_(sheet, HEADERS.l4_sessions);
  assert.deepEqual(sheet.data[0], HEADERS.l4_sessions);
  assert.deepEqual(sheet.data[1], ['기존 행', '수정 금지']); assert.deepEqual(sheet.additions, [11]);
  box.classroomHeaders_(sheet, HEADERS.l4_sessions); assert.deepEqual(sheet.additions, [11]);
});
test('GAS config adapter는 열 순서·메모·다른 설정을 유지하며 모두 닫힌 빈값도 기록한다', () => {
  const sheet = sheetFixture([['note','value','key'], ['설명 유지','2','acceptLessons'], ['다른 설정','11','classCount']]);
  const box = sandboxFor(sheet); let store;
  box.ClassroomService.createService = options => { store = options.store; return {}; };
  box.classroomService_();
  store.writeConfig('acceptLessons', '2,4');
  assert.deepEqual(sheet.data[1], ['설명 유지','2,4','acceptLessons']);
  store.writeConfig('acceptLessons', '');
  assert.deepEqual(sheet.data[1], ['설명 유지','','acceptLessons']);
  assert.deepEqual(sheet.data[2], ['다른 설정','11','classCount']);
  assert.throws(() => store.writeConfig('PASSCODE', 'ignored'), error => error.code === 'INVALID_CONFIG');
});
test('생성 GAS 4차시 엔진·콘텐츠는 양 입장 3·4·5문항에서 Node와 동일하다', () => {
  const box = sandboxFor(sheetFixture([HEADERS.config])), node = createLesson4Engine(lesson4Content);
  const gas = box.ClassroomLesson4.createLesson4Engine(box.ClassroomLesson4Content);
  for (const stance of ['찬성','반대']) for (const questionCount of [3,4,5]) {
    const input = { stance, questionCount, sessionId: `l4-native-${stance === '찬성' ? 'pro' : 'con'}-${questionCount}`, arg1: '의료 상담의 공공 도입은 접근성과 정보 보호의 조건을 함께 검토해야 합니다.', arg5: '', seed: 'native-equality' };
    let left = node.buildSession(input), right = gas.buildSession(input);
    for (let turn = 1; turn <= questionCount; turn++) {
      assert.deepEqual(JSON.parse(JSON.stringify(gas.getQuestion(right, turn))), node.getQuestion(left, turn));
      const answer = { turn, answer: '한계는 인정합니다. 다만 자료의 출처와 정책의 적용 범위를 검토해서 근거를 보완하겠습니다.', helpIds: [] };
      left = node.recordAnswer(left, answer); right = gas.recordAnswer(right, answer);
    }
    const finish = { reflection: '다음에는 출처와 적용 범위를 먼저 확인하겠습니다.', earlyFinish: false };
    assert.deepEqual(JSON.parse(JSON.stringify(gas.finishSession(right, finish))), node.finishSession(left, finish));
  }
});

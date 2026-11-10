'use strict';
/*
 * 毎日トレーニングのロジック検証用スモークテスト（依存なし、Node で実行）。
 *
 * js/main.js を DOM スタブの上で読み込み、日種別判定（#24）・連続日数・
 * 期間集計・対戦カード検証・インポート検証（#22）・当日の目標固定（#25）
 * の代表ケースを確認する。
 *
 * 実行: node tests/smoke.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');

/* ---------- DOM スタブ ---------- */
function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    style: {},
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    selected: false,
    files: null,
    _text: '',
    _attrs: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c); else this._set.add(c);
        } else if (force) this._set.add(c); else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    setAttribute(name, v) { this._attrs[name] = String(v); },
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; },
    removeAttribute(name) { delete this._attrs[name]; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    click() {},
    reset() {}
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); this.children = []; }
  });
  Object.defineProperty(el, 'className', {
    get() { return Array.from(this.classList._set).join(' '); },
    set(v) {
      this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
    }
  });
  return el;
}

const elementsById = {};
for (const m of html.matchAll(/id="([^"]+)"/g)) {
  elementsById[m[1]] = makeElement('div');
}

const localStore = new Map();
const localStorageStub = {
  getItem(k) { return localStore.has(k) ? localStore.get(k) : null; },
  setItem(k, v) { localStore.set(k, String(v)); },
  removeItem(k) { localStore.delete(k); }
};

const documentStub = {
  getElementById(id) {
    if (!elementsById[id]) elementsById[id] = makeElement('div');
    return elementsById[id];
  },
  createElement(tag) { return makeElement(tag); },
  documentElement: makeElement('html'),
  body: makeElement('body'),
  activeElement: null
};

const context = {
  console,
  setTimeout,
  clearTimeout,
  document: documentStub,
  localStorage: localStorageStub,
  location: { hash: '' },
  history: { replaceState() {} },
  navigator: {},
  addEventListener() {},
  matchMedia() { return { matches: false }; },
  confirm() { return true; }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(mainJs, context, { filename: 'js/main.js' });

/* ---------- テストヘルパー ---------- */
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log('ok   - ' + name);
  } else {
    failed += 1;
    console.log('FAIL - ' + name);
  }
}
function eq(name, actual, expected) {
  check(name + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')', actual === expected);
}

const api = context;

/* 日付ユーティリティ（main.js と同じキー形式） */
function keyOf(date) { return api.dateKeyOf(date); }
function daysAgo(n) {
  const t = api.todayDate();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
}
function completeRecord() {
  return {
    done: { 'ex-a': 1 },
    short: false,
    dayType: 'training',
    targets: { 'ex-a': 1 },
    names: { 'ex-a': 'テスト種目' },
    amounts: { 'ex-a': 10 },
    units: { 'ex-a': '回' }
  };
}

/* ---------- (a) 日種別判定: ライブ設定 ---------- */
(function () {
  api.state.records = {};
  api.state.settings.trainingWeekdays = [0, 1, 2, 3, 4, 5, 6];
  api.state.settings.shortWeekdays = [];
  const today = api.todayDate();
  eq('全曜日トレーニング日・短縮なし → normal', api.dayKindFor(keyOf(today), today), 'normal');

  api.state.settings.shortWeekdays = [today.getDay()];
  eq('短縮曜日に含まれる → short', api.dayKindFor(keyOf(today), today), 'short');

  api.state.settings.trainingWeekdays = [];
  eq('トレーニング曜日が空 → rest', api.dayKindFor(keyOf(today), today), 'rest');
})();

/* ---------- (b) #24: 保存済みの日種別が設定変更に影響されない ---------- */
(function () {
  const past = daysAgo(3);
  const key = keyOf(past);
  api.state.settings.trainingWeekdays = [];
  api.state.records = {};
  api.state.records[key] = completeRecord(); // dayType: 'training'
  eq('記録に training とあれば、設定が全休みでもトレーニング日',
    api.isTrainingRecordDay(key, past), true);

  api.state.settings.trainingWeekdays = [0, 1, 2, 3, 4, 5, 6];
  api.state.records[key] = { done: {}, short: false, dayType: 'rest' };
  eq('記録に rest とあれば、設定が全日でも休みの日',
    api.isTrainingRecordDay(key, past), false);

  delete api.state.records[key];
  eq('種別の無い旧記録は現在の設定で判定（後方互換）',
    api.isTrainingRecordDay(key, past), true);
})();

/* ---------- (c) 連続日数 ---------- */
(function () {
  api.state.exercises = [{ id: 'ex-a', name: 'テスト種目', amount: 10, unit: '回', sets: 1, note: '' }];
  api.state.settings.trainingWeekdays = [0, 1, 2, 3, 4, 5, 6];
  api.state.settings.shortWeekdays = [];
  api.state.records = {};
  api.state.records[keyOf(daysAgo(0))] = completeRecord();
  api.state.records[keyOf(daysAgo(1))] = completeRecord();
  const incomplete = completeRecord();
  incomplete.done = { 'ex-a': 0 };
  api.state.records[keyOf(daysAgo(2))] = incomplete;
  eq('今日・昨日が完了、一昨日が未完了 → 連続2日', api.calcStreak(), 2);
})();

/* ---------- (d) 期間集計 ---------- */
(function () {
  api.state.records = {};
  const today = api.todayDate();
  const thisMonday = api.startOfWeekMonday(today);
  const start = api.addDays(thisMonday, -7); // 先週の月曜
  const end = api.addDays(start, 6); // 先週の日曜
  for (let i = 0; i < 3; i++) {
    api.state.records[keyOf(api.addDays(start, i))] = completeRecord();
  }
  const stats = api.periodStats(start, end);
  eq('先週1週間のトレーニング日数', stats.trainingDays, 7);
  eq('先週1週間の完了日数', stats.completeDays, 3);
  eq('先週1週間の完了率', stats.rate, 43);
  eq('先週1週間の合計セット数', stats.sets, 3);
})();

/* ---------- (e) 対戦カードの検証 ---------- */
(function () {
  const valid = {
    type: 'daily-training-card',
    version: 1,
    cardId: 'card-test-1',
    nickname: 'ともだち',
    bio: 'よろしく',
    image: '',
    generatedAt: '2026年1月1日',
    totals: { totalDays: 5, longestStreak: 3, currentStreak: 2, totalSets: 40 }
  };
  const card = api.sanitizeCard(valid);
  check('正しいカードは取り込める', card !== null);
  eq('cardId が保持される', card && card.cardId, 'card-test-1');

  eq('type が違うカードは null', api.sanitizeCard({ type: 'other', version: 1 }), null);
  eq('null は null', api.sanitizeCard(null), null);

  const oldCard = api.sanitizeCard({
    type: 'daily-training-card',
    version: 1,
    nickname: 'むかしの友達',
    totals: { totalDays: 1, longestStreak: 1, currentStreak: 1, totalSets: 2 }
  });
  check('cardId・bio・image の無い旧形式カードも取り込める', oldCard !== null);
  eq('旧形式カードの cardId は空文字', oldCard && oldCard.cardId, '');
})();

/* ---------- (f) インポート検証（#22 #27 #28） ---------- */
(function () {
  const validPayload = {
    schemaVersion: 1,
    exercises: [{ name: 'テスト', amount: 10, unit: '回', sets: 2, note: '' }],
    records: { '2026-01-05': { done: { a: 1 }, short: false } },
    settings: { weeklyGoal: 3 },
    profile: { bio: 'hello', image: '' },
    rivals: []
  };
  eq('正しいデータは検証を通る', api.validateImportData(validPayload).ok, true);

  const oldPayload = {
    exercises: [{ name: 'テスト', amount: 10, unit: '回', sets: 2 }],
    records: {}
  };
  const oldResult = api.validateImportData(oldPayload);
  eq('schemaVersion の無い旧形式も検証を通る', oldResult.ok, true);
  eq('profile が無い場合は null（現在のものを保持）', oldResult.data && oldResult.data.profile, null);
  eq('rivals が無い場合は null（現在のものを保持）', oldResult.data && oldResult.data.rivals, null);

  eq('exercises が配列でないとエラー',
    api.validateImportData({ exercises: 'x', records: {} }).ok, false);
  eq('存在しない日付キーはエラー',
    api.validateImportData({ exercises: [], records: { '2026-13-40': { done: {} } } }).ok, false);
  eq('完了セット数が範囲外だとエラー',
    api.validateImportData({ exercises: [], records: { '2026-01-05': { done: { a: 1000 } } } }).ok, false);
  eq('未知の新しい schemaVersion はエラー',
    api.validateImportData({ schemaVersion: 2, exercises: [], records: {} }).ok, false);

  const many = { exercises: [], records: {} };
  for (let i = 0; i < 201; i++) many.exercises.push({ name: '種目' + i, amount: 1, unit: '回', sets: 1 });
  eq('種目が上限（200件）を超えるとエラー', api.validateImportData(many).ok, false);

  eq('データ自体がオブジェクトでないとエラー',
    api.validateImportData('just a string').ok, false);
})();

/* ---------- (g) #25: 当日のスナップショットは設定変更で上書きされない ---------- */
(function () {
  api.state.exercises = [{ id: 'ex-a', name: 'テスト種目', amount: 10, unit: '回', sets: 2, note: '' }];
  api.state.records = {};
  const first = api.ensureTodayRecord(false);
  eq('作成直後の目標は2セット', first.targets['ex-a'], 2);

  api.state.exercises[0].sets = 5;
  api.state.exercises[0].amount = 99;
  const second = api.ensureTodayRecord(false);
  eq('種目の設定を変えても、その日の目標は2セットのまま', second.targets['ex-a'], 2);
  eq('種目の設定を変えても、その日の数値は10のまま', second.amounts['ex-a'], 10);

  api.state.exercises.push({ id: 'ex-b', name: '追加種目', amount: 5, unit: '回', sets: 3, note: '' });
  const third = api.ensureTodayRecord(false);
  eq('あとから追加された種目だけがスナップショットに加わる', third.targets['ex-b'], 3);
  eq('既存種目の目標は変わらない', third.targets['ex-a'], 2);
})();

/* ---------- (h) R9: スキップした種目は完了条件と集計から外れる ---------- */
(function () {
  api.state.exercises = [
    { id: 'ex-a', name: '種目A', amount: 10, unit: '回', sets: 2, note: '' },
    { id: 'ex-b', name: '種目B', amount: 10, unit: '回', sets: 2, note: '' }
  ];
  api.state.settings.trainingWeekdays = [0, 1, 2, 3, 4, 5, 6];
  api.state.settings.shortWeekdays = [];
  api.state.records = {};
  const today = api.todayDate();
  const key = keyOf(today);
  api.state.records[key] = {
    done: { 'ex-a': 2, 'ex-b': 2 },
    skipped: { 'ex-b': true },
    short: false,
    dayType: 'training',
    targets: { 'ex-a': 2, 'ex-b': 2 },
    names: { 'ex-a': '種目A', 'ex-b': '種目B' },
    amounts: { 'ex-a': 10, 'ex-b': 10 },
    units: { 'ex-a': '回', 'ex-b': '回' }
  };
  const stats = api.dayStats(key);
  eq('スキップした種目は完了率の分母から外れる', stats.totalTarget, 2);
  eq('スキップした種目の完了分は数えない', stats.totalDone, 2);
  eq('残りが完了していれば、スキップがあってもその日は完了', stats.complete, true);
  eq('スキップ件数', stats.skippedCount, 1);
  eq('entry の skipped フラグ', stats.entries[1].skipped, true);
  eq('スキップした種目の countedDone は 0', stats.entries[1].countedDone, 0);

  const period = api.periodStats(today, today);
  eq('期間集計の完了セット数にスキップ分は入らない', period.sets, 2);
  eq('期間集計の合計回数にスキップ分は入らない', period.reps, 20);

  /* 全部スキップでも、その日は完了として扱う */
  api.state.records[key].done = { 'ex-a': 0, 'ex-b': 0 };
  api.state.records[key].skipped = { 'ex-a': true, 'ex-b': true };
  const allSkipped = api.dayStats(key);
  eq('全種目スキップなら完了', allSkipped.complete, true);
  eq('全種目スキップなら完了率100%', allSkipped.rate, 100);

  /* skipped の無い旧記録でも壊れない（後方互換） */
  delete api.state.records[key].skipped;
  api.state.records[key].done = { 'ex-a': 2, 'ex-b': 1 };
  const legacy = api.dayStats(key);
  eq('skipped の無い旧記録は従来どおり集計', legacy.totalTarget, 4);
  eq('skipped の無い旧記録は未完了', legacy.complete, false);
})();

/* ---------- (i) R15: 引き継ぎコードの変換 ---------- */
(function () {
  const original = JSON.stringify({ app: 'daily-training', note: '日本語のデータ 🎉', n: 42 });
  const code = api.encodeTransferCode(original);
  check('コードは Base64 文字だけでできている', /^[A-Za-z0-9+/=]+$/.test(code));
  eq('日本語を含むJSONが往復で戻る', api.decodeTransferCode(code), original);
  eq('空白や改行が混ざっても読める', api.decodeTransferCode(code.slice(0, 8) + '\n' + code.slice(8)), original);
  eq('Base64でない文字列は null', api.decodeTransferCode('これはコードではありません!!!'), null);
  eq('空文字は null', api.decodeTransferCode(''), null);
  eq('文字列でないものは null', api.decodeTransferCode(null), null);
})();

/* ---------- (j) インポート検証: skipped の形式 ---------- */
(function () {
  const withSkip = {
    exercises: [],
    records: { '2026-01-05': { done: {}, short: false, skipped: { 'ex-a': true } } }
  };
  eq('skipped（真偽値）は検証を通る', api.validateImportData(withSkip).ok, true);
  const badSkip = {
    exercises: [],
    records: { '2026-01-05': { done: {}, skipped: { 'ex-a': 'yes' } } }
  };
  eq('skipped の値が真偽値でないとエラー', api.validateImportData(badSkip).ok, false);
})();

/* ---------- (k) R4: すべて完了と元に戻す ---------- */
(function () {
  api.state.exercises = [
    { id: 'ex-a', name: '種目A', amount: 10, unit: '回', sets: 2, note: '' },
    { id: 'ex-b', name: '種目B', amount: 5, unit: '秒', sets: 1, note: '' }
  ];
  api.state.settings.shortWeekdays = [];
  api.state.records = {};
  api.completeAllToday();
  const key = keyOf(api.todayDate());
  const record = api.getRecord(key);
  check('すべて完了で記録が作られる', record !== null);
  eq('種目Aは目標どおり完了', record && record.done['ex-a'], 2);
  eq('種目Bは目標どおり完了', record && record.done['ex-b'], 1);
  eq('すべて完了後はその日が完了', api.dayStats(key).complete, true);
  api.undoCompleteAll();
  eq('元に戻すと記録自体が無かったことになる', api.getRecord(key), null);
})();

/* ---------- (l) R2: 種目テンプレート ---------- */
(function () {
  check('テンプレートは10件ある', api.EXERCISE_TEMPLATES.length >= 10);
  const names = api.EXERCISE_TEMPLATES.map(function (t) { return t.name; });
  eq('テンプレートの名前は重複しない', new Set(names).size, names.length);
  const allValid = api.EXERCISE_TEMPLATES.every(function (t) {
    return api.sanitizeExercise(JSON.parse(JSON.stringify(t))) !== null;
  });
  check('テンプレートはすべて種目として整形できる', allValid);
})();

/* ---------- (m) R8: 今日の目標への反映 ---------- */
(function () {
  api.state.exercises = [{ id: 'ex-a', name: 'テスト種目', amount: 10, unit: '回', sets: 2, note: '' }];
  api.state.records = {};
  const record = api.ensureTodayRecord(false);
  record.done['ex-a'] = 1;
  const applied = api.reflectEditsToToday([{ id: 'ex-a', name: 'テスト種目', amount: 15, unit: '回', sets: 3 }]);
  eq('今日の記録があれば反映できる', applied, true);
  eq('今日の目標セット数が新しい値になる', record.targets['ex-a'], 3);
  eq('今日の目標の数値が新しい値になる', record.amounts['ex-a'], 15);
  eq('完了済みセット数は変わらない', record.done['ex-a'], 1);
  eq('スナップショットに無い種目は反映対象外',
    api.reflectEditsToToday([{ id: 'ex-zzz', name: '不明', amount: 1, unit: '回', sets: 1 }]), false);
  api.state.records = {};
  eq('今日の記録が無ければ反映しない',
    api.reflectEditsToToday([{ id: 'ex-a', name: 'テスト種目', amount: 15, unit: '回', sets: 3 }]), false);
})();

/* ---------- (n) R3: まとめて編集の保存 ---------- */
(function () {
  api.state.exercises = [
    { id: 'ex-a', name: '種目A', amount: 10, unit: '回', sets: 2, note: '' },
    { id: 'ex-b', name: '種目B', amount: 5, unit: '秒', sets: 1, note: 'メモ' }
  ];
  api.state.records = {};
  api.bulkEditMode = true;
  api.renderManage();
  check('まとめて編集の入力欄が作られる', !!api.bulkInputs['ex-a']);
  api.bulkInputs['ex-a'].amount.value = '25';
  api.bulkInputs['ex-a'].sets.value = '4';
  api.bulkInputs['ex-b'].unit.value = '回';
  api.saveBulkEdit();
  eq('まとめて保存で数値が変わる', api.state.exercises[0].amount, 25);
  eq('まとめて保存でセット数が変わる', api.state.exercises[0].sets, 4);
  eq('まとめて保存で単位が変わる', api.state.exercises[1].unit, '回');
  eq('まとめて保存で名前とメモは変わらない', api.state.exercises[1].note, 'メモ');
  eq('保存後はまとめて編集モードを抜ける', api.bulkEditMode, false);
})();

/* ---------- (o) R12: 初期メニューの判定 ---------- */
(function () {
  api.state.exercises = JSON.parse(JSON.stringify(api.SEED_EXERCISES));
  eq('初期の6種目のままなら true', api.isInitialMenu(), true);
  api.state.exercises.pop();
  eq('1つ外すと false', api.isInitialMenu(), false);
})();

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

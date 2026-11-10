'use strict';

/* 毎日トレーニング: データ駆動の自重トレーニング記録アプリ
   データは localStorage のみに保存し、外部送信は一切しない。 */

// ===== 定数 =====
var STORAGE_KEYS = {
  exercises: 'dailyTraining.exercises.v1',
  records: 'dailyTraining.records.v1',
  settings: 'dailyTraining.settings.v1',
  rivals: 'dailyTraining.rivals.v1',
  profile: 'dailyTraining.profile.v1',
  prefs: 'dailyTraining.prefs.v1',
  backup: 'dailyTraining.backup.v1'
};

/* 書き出しJSONの形式バージョン。保存データ側にも同じ値を持つ。 */
var SCHEMA_VERSION = 1;

/* ファイル読み込み前の上限（#28）。件数の上限もここで管理する。 */
var FILE_LIMITS = {
  jsonBytes: 5 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  exercisesMax: 200,
  rivalsMax: 5
};

/* プロフィール画像: 最大256×256に縮小し、data URL の目安は約300KB。
   取り込み時の上限は余裕を持たせて約500KB。 */
var PROFILE_IMAGE_MAX_PX = 256;
var PROFILE_IMAGE_TARGET_LENGTH = 300000;
var PROFILE_IMAGE_MAX_LENGTH = 500000;
var PROFILE_BIO_MAX = 200;

var WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/* はじめのメニュー（テンプレート）。すべて編集・削除できる。 */
var SEED_EXERCISES = [
  { id: 'ex-pushup', name: '腕立て伏せ', amount: 20, unit: '回', sets: 2, note: '' },
  { id: 'ex-crunch', name: 'クランチ', amount: 30, unit: '回', sets: 2, note: 'お尻は地面につけたまま' },
  { id: 'ex-hip-lift', name: 'ヒップリフト', amount: 20, unit: '回', sets: 2, note: '' },
  { id: 'ex-back', name: '背筋', amount: 30, unit: '回', sets: 2, note: '小さく持ち上げるだけ。腰に違和感がある日は半分でもOK' },
  { id: 'ex-calf', name: 'つま先立ち', amount: 30, unit: '回', sets: 2, note: 'ゆっくり。壁に手をついてOK' },
  { id: 'ex-plank', name: 'プランク', amount: 30, unit: '秒', sets: 2, note: '' }
];

var DEFAULT_SETTINGS = {
  shortGoalSets: 1,
  shortWeekdays: [],
  trainingWeekdays: [0, 1, 2, 3, 4, 5, 6],
  timeSlot: 'undecided',
  timeValue: '',
  weeklyGoal: 0,
  theme: '',
  nickname: '',
  cardId: ''
};

/* アプリの細かな状態（案内の表示、マイページの期間選択、最終書き出し日）。
   データ本体とは別のキーに分けて保存する。 */
var DEFAULT_PREFS = {
  schemaVersion: SCHEMA_VERSION,
  guideDismissed: false,
  exportLastAt: '',
  mpYear: null,
  mpMonth: null,
  mpWeek: ''
};

/* やる時間の時間帯ラベル。「決めていない」は予定表示に出さない。 */
var TIME_SLOT_LABELS = { morning: '朝', noon: '昼', night: '夜', undecided: '' };

// ===== 状態 =====
var state = {
  exercises: [],
  records: {},
  settings: Object.assign({}, DEFAULT_SETTINGS),
  rivals: [],
  profile: { image: '', bio: '' },
  prefs: Object.assign({}, DEFAULT_PREFS)
};

// ===== ユーティリティ =====
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    var parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

/* 保存の成否を追跡し、失敗したら画面上部の警告バナーで知らせる（#23）。
   成功が続けばバナーは消す。 */
var saveFailed = false;

function updateSaveWarning() {
  if (typeof el !== 'undefined' && el.saveWarning) {
    el.saveWarning.hidden = !saveFailed;
  }
}

function saveKey(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (saveFailed) {
      saveFailed = false;
      updateSaveWarning();
    }
    return true;
  } catch (e) {
    saveFailed = true;
    updateSaveWarning();
    return false;
  }
}

function saveExercises() { saveKey(STORAGE_KEYS.exercises, state.exercises); }
function saveRecords() { saveKey(STORAGE_KEYS.records, state.records); }
function saveSettings() { saveKey(STORAGE_KEYS.settings, state.settings); }
function saveRivals() { saveKey(STORAGE_KEYS.rivals, state.rivals); }
function saveProfile() { saveKey(STORAGE_KEYS.profile, state.profile); }
function savePrefs() { saveKey(STORAGE_KEYS.prefs, state.prefs); }

/* プロフィール（画像・紹介文）を検証して整える。
   画像は data URL の画像だけを受け付け、容量上限を超えるものは捨てる。 */
function sanitizeProfile(raw) {
  var profile = { image: '', bio: '' };
  if (raw && typeof raw === 'object') {
    if (typeof raw.image === 'string' && raw.image.indexOf('data:image/') === 0 &&
        raw.image.length <= PROFILE_IMAGE_MAX_LENGTH) {
      profile.image = raw.image;
    }
    if (typeof raw.bio === 'string') {
      profile.bio = raw.bio.slice(0, PROFILE_BIO_MAX);
    }
  }
  return profile;
}

/* 表示用のニックネーム（未設定時は「あなた」） */
function displayNickname() {
  var nickname = state.settings.nickname.trim();
  return nickname !== '' ? nickname : 'あなた';
}
function saveAll() { saveExercises(); saveRecords(); saveSettings(); }

function uid() {
  return 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function toInt(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (isNaN(n)) n = fallback;
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}

function sanitizeExercise(raw, fallbackId) {
  if (!raw || typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : (fallbackId || uid()),
    name: raw.name.trim(),
    amount: toInt(raw.amount, 20, 1, 999),
    unit: raw.unit === '秒' ? '秒' : '回',
    sets: toInt(raw.sets, 2, 1, 10),
    note: typeof raw.note === 'string' ? raw.note : ''
  };
}

/* 曜日番号（0=日〜6=土）の配列を、重複なし・範囲内に整える。 */
function sanitizeWeekdays(raw, fallback) {
  if (!Array.isArray(raw)) return clone(fallback);
  var days = [];
  raw.forEach(function (d) {
    var n = toInt(d, -1, 0, 6);
    if (n >= 0 && days.indexOf(n) === -1) days.push(n);
  });
  days.sort(function (a, b) { return a - b; });
  return days;
}

function sanitizeSettings(raw) {
  var s = Object.assign({}, DEFAULT_SETTINGS);
  s.trainingWeekdays = clone(DEFAULT_SETTINGS.trainingWeekdays);
  if (raw && typeof raw === 'object') {
    s.shortGoalSets = toInt(raw.shortGoalSets, 1, 1, 10);
    s.shortWeekdays = sanitizeWeekdays(raw.shortWeekdays, DEFAULT_SETTINGS.shortWeekdays);
    s.trainingWeekdays = sanitizeWeekdays(raw.trainingWeekdays, DEFAULT_SETTINGS.trainingWeekdays);
    if (typeof raw.timeSlot === 'string' &&
        Object.prototype.hasOwnProperty.call(TIME_SLOT_LABELS, raw.timeSlot)) {
      s.timeSlot = raw.timeSlot;
    }
    if (typeof raw.timeValue === 'string' && /^\d{2}:\d{2}$/.test(raw.timeValue)) {
      s.timeValue = raw.timeValue;
    }
    s.weeklyGoal = toInt(raw.weeklyGoal, 0, 0, 7);
    if (raw.theme === 'light' || raw.theme === 'dark') {
      s.theme = raw.theme;
    }
    if (typeof raw.nickname === 'string') {
      s.nickname = raw.nickname.trim().slice(0, 20);
    }
    if (typeof raw.cardId === 'string' && raw.cardId !== '') {
      s.cardId = raw.cardId.slice(0, 64);
    }
  }
  return s;
}

/* prefs（案内の表示状態・マイページの期間選択・最終書き出し日）を整える（#1, #16, #26）。 */
function sanitizePrefs(raw) {
  var p = Object.assign({}, DEFAULT_PREFS);
  if (raw && typeof raw === 'object') {
    p.schemaVersion = SCHEMA_VERSION;
    p.guideDismissed = raw.guideDismissed === true;
    if (typeof raw.exportLastAt === 'string') p.exportLastAt = raw.exportLastAt.slice(0, 40);
    if (typeof raw.mpYear === 'number' && isFinite(raw.mpYear)) {
      p.mpYear = Math.min(9999, Math.max(1, Math.floor(raw.mpYear)));
    }
    if (typeof raw.mpMonth === 'number' && isFinite(raw.mpMonth)) {
      p.mpMonth = Math.min(11, Math.max(0, Math.floor(raw.mpMonth)));
    }
    if (typeof raw.mpWeek === 'string' && mondayFromWeekValue(raw.mpWeek) !== null) {
      p.mpWeek = raw.mpWeek;
    }
  }
  return p;
}

/* テーマ: 設定に保存があればそれ、無ければ端末の prefers-color-scheme に従う。 */
function resolvedTheme() {
  if (state.settings.theme === 'light' || state.settings.theme === 'dark') {
    return state.settings.theme;
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme() {
  var theme = resolvedTheme();
  document.documentElement.setAttribute('data-theme', theme);
  [el.themeToggle, el.settingsThemeBtn].forEach(function (btn) {
    if (btn) {
      btn.textContent = theme === 'dark' ? 'ライトモードにする' : 'ダークモードにする';
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  });
}

// ===== 日付 =====
function dateKeyOf(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function parseKey(key) {
  var parts = key.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function todayDate() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateJa(date) {
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() +
    '日（' + WEEKDAYS_JA[date.getDay()] + '）';
}

/* その日が短縮日かどうか（設定で選んだ曜日かどうか）。
   曜日による固定の自動判定はしない。 */
function defaultShortFor(date) {
  return state.settings.shortWeekdays.indexOf(date.getDay()) !== -1;
}

/* 設定の「トレーニングする曜日」に含まれる日かどうか（現在の設定でのライブ判定）。 */
function isTrainingDay(date) {
  return state.settings.trainingWeekdays.indexOf(date.getDay()) !== -1;
}

/* 記録に保存済みの日種別（'training' / 'rest'）。無い記録は null（#24）。
   記録を作る時点でその日の種別を固定し、後の設定変更で過去が変わらないようにする。 */
function storedDayType(key) {
  var record = getRecord(key);
  if (record && (record.dayType === 'training' || record.dayType === 'rest')) {
    return record.dayType;
  }
  return null;
}

/* その日がトレーニング日かどうか。保存済みの種別があればそれを使い、
   無ければ（旧形式の記録や未記録の日）現在の設定で判定する（後方互換）。 */
function isTrainingRecordDay(key, date) {
  var stored = storedDayType(key);
  if (stored !== null) return stored === 'training';
  return isTrainingDay(date);
}

/* 日種別: 'rest'（休みの日）/ 'short'（短縮日）/ 'normal'（通常日） */
function dayKindFor(key, date) {
  if (!isTrainingRecordDay(key, date)) return 'rest';
  return effectiveShort(key, date) ? 'short' : 'normal';
}

/* 「今日の予定」に出す時間の文言。時間帯が「決めていない」で時刻も無い場合は空。 */
function timeTextFor() {
  var label = TIME_SLOT_LABELS[state.settings.timeSlot] || '';
  var value = state.settings.timeValue;
  if (label && value) return label + ' ' + value + 'ごろ';
  if (value) return value + 'ごろ';
  return label;
}

// ===== 記録 =====
function getRecord(key) {
  return state.records[key] || null;
}

/* 今日の実効値: 保存済みの記録があればそれ（手動トグルが優先）、
   なければ設定の曜日選択から初期値を決める。 */
function effectiveShort(key, date) {
  var record = getRecord(key);
  if (record && typeof record.short === 'boolean') return record.short;
  return defaultShortFor(date);
}

function targetSetsFor(exercise, short) {
  return short ? Math.min(exercise.sets, state.settings.shortGoalSets) : exercise.sets;
}

/* その日のスナップショット（種目名・目標セット数・回数/秒数・単位）を記録に残す。
   種目を後で消したり変えたりしても、その日の履歴や集計が壊れないようにするため。
   旧形式の記録（amounts / units が無い）もそのまま読める。
   目標セット数は短縮を適用しない素のセット数（base）を保存し、短縮の適用は
   dayStats 側で record.short を見て行う。
   一度保存した種目の目標は上書きしない（#25）。当日あとから追加された種目だけが
   スナップショットに加わる。 */
function refreshSnapshot(record) {
  if (!record.targets || typeof record.targets !== 'object') record.targets = {};
  if (!record.names || typeof record.names !== 'object') record.names = {};
  if (!record.amounts || typeof record.amounts !== 'object') record.amounts = {};
  if (!record.units || typeof record.units !== 'object') record.units = {};
  state.exercises.forEach(function (ex) {
    if (typeof record.targets[ex.id] !== 'number') {
      record.targets[ex.id] = ex.sets;
      record.names[ex.id] = ex.name;
      record.amounts[ex.id] = ex.amount;
      record.units[ex.id] = ex.unit;
    }
  });
}

/* スナップショットを現在の種目で作り直す（過去日の編集で新規に記録を作るときだけ使う）。 */
function writeSnapshot(record, short) {
  record.targets = {};
  record.names = {};
  record.amounts = {};
  record.units = {};
  state.exercises.forEach(function (ex) {
    record.targets[ex.id] = ex.sets;
    record.names[ex.id] = ex.name;
    record.amounts[ex.id] = ex.amount;
    record.units[ex.id] = ex.unit;
  });
}

function ensureTodayRecord(short) {
  var key = dateKeyOf(todayDate());
  var record = getRecord(key);
  if (!record) {
    record = {
      done: {},
      short: short,
      /* 記録を作る時点の日種別を固定する（#24） */
      dayType: isTrainingDay(todayDate()) ? 'training' : 'rest'
    };
    state.records[key] = record;
  }
  if (typeof record.done !== 'object' || record.done === null) record.done = {};
  record.short = short;
  refreshSnapshot(record);
  return record;
}

/* 1日の統計。スナップショットがあればそれを使い、なければ現在の種目で計算する。 */
function dayStats(key) {
  var record = getRecord(key);
  var date = parseKey(key);
  var short = record && typeof record.short === 'boolean' ? record.short : defaultShortFor(date);
  var entries = [];
  var totalTarget = 0;
  var totalDone = 0;

  if (record && record.targets && typeof record.targets === 'object') {
    Object.keys(record.targets).forEach(function (id) {
      var baseTarget = toInt(record.targets[id], 0, 0, 999);
      /* スナップショットの目標は素のセット数。短縮日はここで1セット相当に絞る。
         旧形式の記録（短縮適用済みの目標が保存されている）でも、
         min を取るため結果は変わらない。 */
      var target = short ? Math.min(baseTarget, state.settings.shortGoalSets) : baseTarget;
      var doneRaw = record.done && typeof record.done[id] === 'number' ? record.done[id] : 0;
      var done = Math.min(doneRaw, target);
      var name = record.names && typeof record.names[id] === 'string' ? record.names[id] : '削除済みの種目';
      /* 回数・単位はスナップショットから取る。旧形式の記録で無い場合は、
         いま存在する種目から補い、それも無ければ null（合計回数の集計対象外）。 */
      var amount = record.amounts && typeof record.amounts[id] === 'number' ? record.amounts[id] : null;
      var unit = record.units && typeof record.units[id] === 'string' ? record.units[id] : null;
      if (amount === null || unit === null) {
        var current = null;
        state.exercises.forEach(function (ex) { if (ex.id === id) current = ex; });
        if (current) {
          if (amount === null) amount = current.amount;
          if (unit === null) unit = current.unit;
        }
      }
      entries.push({ id: id, name: name, target: target, done: done, amount: amount, unit: unit });
      totalTarget += target;
      totalDone += done;
    });
  } else {
    state.exercises.forEach(function (ex) {
      var target = targetSetsFor(ex, short);
      var doneRaw = record && record.done && typeof record.done[ex.id] === 'number' ? record.done[ex.id] : 0;
      var done = Math.min(doneRaw, target);
      entries.push({ id: ex.id, name: ex.name, target: target, done: done, amount: ex.amount, unit: ex.unit });
      totalTarget += target;
      totalDone += done;
    });
    /* 現在の種目に無いIDの記録があっても壊れないように名前だけ拾う */
    if (record && record.done) {
      Object.keys(record.done).forEach(function (id) {
        var known = state.exercises.some(function (ex) { return ex.id === id; });
        if (!known) {
          entries.push({ id: id, name: '削除済みの種目', target: 0, done: 0, amount: null, unit: null });
        }
      });
    }
  }

  var rate = totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0;
  var complete = totalTarget > 0 && totalDone >= totalTarget;
  return { entries: entries, totalTarget: totalTarget, totalDone: totalDone, rate: rate, complete: complete, short: short };
}

/* 連続日数: トレーニングする日だけを対象に、完了が何日続いているかを数える。
   休みの日はスキップして数え、連続を切らない。
   今日がトレーニング日でまだ未完了なら、昨日以前から数える。
   今日が休みの日なら、直近のトレーニング日から数える。 */
function calcStreak() {
  var streak = 0;
  var cursor = todayDate();
  if (isTrainingRecordDay(dateKeyOf(cursor), cursor) && !dayStats(dateKeyOf(cursor)).complete) {
    cursor.setDate(cursor.getDate() - 1);
  }
  var guard = 0;
  while (guard < 3660) {
    guard += 1;
    if (isTrainingRecordDay(dateKeyOf(cursor), cursor)) {
      if (dayStats(dateKeyOf(cursor)).complete) {
        streak += 1;
      } else {
        break;
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ===== 集計（マイページ用） =====
function addDays(date, n) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/* start から end（含む）までの期間集計。
   未来の日は数えない。スナップショットをもとに計算するので、
   種目を削除・変更しても過去の集計は壊れない。
   - trainingDays / completeDays: トレーニングの日だけを対象にする
   - sets: 完了セット数の合計（全日）
   - reps: 単位が「回」で回数が分かる種目だけの合計回数（完了セット数 × amount）
   - hasData: 期間内に記録が1日でもあるか（「データなし」の表示判定） */
function periodStats(start, end) {
  var today = todayDate();
  var result = {
    trainingDays: 0, completeDays: 0, sets: 0, reps: 0,
    hasData: false, repsKnown: false, rate: null
  };
  var last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (last > today) last = today;
  var cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= last) {
    var key = dateKeyOf(cursor);
    if (getRecord(key)) result.hasData = true;
    var stats = dayStats(key);
    if (isTrainingRecordDay(key, cursor)) {
      result.trainingDays += 1;
      if (stats.complete) result.completeDays += 1;
    }
    result.sets += stats.totalDone;
    stats.entries.forEach(function (entry) {
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        result.repsKnown = true;
        result.reps += entry.done * entry.amount;
      }
    });
    cursor = addDays(cursor, 1);
  }
  if (result.trainingDays > 0) {
    result.rate = Math.round((result.completeDays / result.trainingDays) * 100);
  }
  return result;
}

/* 月曜はじまりの週の開始日 */
function startOfWeekMonday(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* 日付から input[type=week] 用の ISO週文字列（例: 2026-W46）を作る */
function isoWeekValue(date) {
  var monday = startOfWeekMonday(date);
  var thursday = addDays(monday, 3);
  var isoYear = thursday.getFullYear();
  var week1Monday = startOfWeekMonday(new Date(isoYear, 0, 4));
  var week = Math.round((monday - week1Monday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return isoYear + '-W' + String(week).padStart(2, '0');
}

/* ISO週文字列からその週の月曜を返す。読めない値なら null（＝今週として扱う）。 */
function mondayFromWeekValue(value) {
  var m = /^(\d{4})-W(\d{1,2})$/.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  var week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  var week1Monday = startOfWeekMonday(new Date(Number(m[1]), 0, 4));
  return addDays(week1Monday, (week - 1) * 7);
}

/* 今週（月曜〜日曜）の進捗。done は今日までの完了したトレーニング日、
   remaining は今日（未完了なら）と今後のトレーニング日の数。 */
function weekProgressStats() {
  var today = todayDate();
  var monday = startOfWeekMonday(today);
  var done = 0;
  var remaining = 0;
  for (var i = 0; i < 7; i++) {
    var d = addDays(monday, i);
    if (!isTrainingRecordDay(dateKeyOf(d), d)) continue;
    var complete = dayStats(dateKeyOf(d)).complete;
    if (d < today) {
      if (complete) done += 1;
    } else if (d.getTime() === today.getTime()) {
      if (complete) done += 1;
      else remaining += 1;
    } else {
      remaining += 1;
    }
  }
  return { done: done, remaining: remaining };
}

/* 種目別の累計。全記録のスナップショットを種目名ごとに集計する。
   削除した種目も、その日のスナップショット名で含める。
   合計回数は単位が「回」で回数が分かるものだけを数える。 */
function exerciseTotals() {
  var byName = {};
  var names = [];
  Object.keys(state.records).forEach(function (key) {
    dayStats(key).entries.forEach(function (entry) {
      if (!byName[entry.name]) {
        byName[entry.name] = { name: entry.name, sets: 0, reps: 0, repsKnown: false };
        names.push(entry.name);
      }
      var total = byName[entry.name];
      total.sets += entry.done;
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        total.repsKnown = true;
        total.reps += entry.done * entry.amount;
      }
    });
  });
  var list = names.map(function (name) { return byName[name]; });
  list = list.filter(function (t) { return t.sets > 0; });
  list.sort(function (a, b) {
    if (b.sets !== a.sets) return b.sets - a.sets;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  return list;
}

/* 全期間を通しての最長連続日数。トレーニングの日だけを数え、
   休みの日はスキップして連続を切らない（calcStreak と同じ考え方）。 */
function calcLongestStreak() {
  var keys = Object.keys(state.records);
  if (keys.length === 0) return 0;
  keys.sort();
  var cursor = parseKey(keys[0]);
  var today = todayDate();
  var longest = 0;
  var current = 0;
  var guard = 0;
  while (cursor <= today && guard < 36600) {
    guard += 1;
    if (isTrainingRecordDay(dateKeyOf(cursor), cursor)) {
      if (dayStats(dateKeyOf(cursor)).complete) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return longest;
}

/* 全期間の累計。スナップショットをもとに計算する。
   totalReps は単位が「回」で回数が分かるものだけを数える。 */
function allTimeTotals() {
  var totals = { totalDays: 0, totalSets: 0, totalReps: 0 };
  Object.keys(state.records).forEach(function (key) {
    var stats = dayStats(key);
    if (isTrainingRecordDay(key, parseKey(key)) && stats.complete) totals.totalDays += 1;
    totals.totalSets += stats.totalDone;
    stats.entries.forEach(function (entry) {
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        totals.totalReps += entry.done * entry.amount;
      }
    });
  });
  return totals;
}

/* 記録がある最も古い年。記録が無ければ null。 */
function oldestRecordYear() {
  var oldest = null;
  Object.keys(state.records).forEach(function (key) {
    var y = Number(key.split('-')[0]);
    if (!isNaN(y) && (oldest === null || y < oldest)) oldest = y;
  });
  return oldest;
}

// ===== Museのアドバイス =====
/* 記録と設定からルールで1つ選んで表示する。外部送信はしない。
   医療的な断定はせず、一般的な文言だけを使う。 */
var ADVICE_TEXTS = {
  rest: '今日は休みの日です。体を休めることも、続けるための大切な一部です。次のトレーニング日に向けて、ゆっくり過ごしましょう。',
  done: '今日は完了しました。おつかれさまです。よく頑張りました。明日も自分のペースでいきましょう。',
  retryShort: '前回のトレーニング日はお休みでしたね。今日は短縮モードで1セットだけでも大丈夫です。少し動かせば、それで十分な一歩です。',
  easeOff: '最近は少し大変だったかもしれません。短縮日にする曜日を増やしたり、セット数を減らしたりして、続けやすい形にしてみましょう。',
  streakLong: 'トレーニングの日が7日以上続けて完了しています。すばらしい継続です。回数を増やさず、この調子を大切にしましょう。',
  streak: '続いていますね。その積み重ねが力になります。今日もいつも通りでいきましょう。',
  first: '記録はまだありません。まずは1種目・1セットからで大丈夫です。小さく始めて、慣れてきたら増やしていきましょう。',
  shortDay: '今日は短縮の日です。各種目1セットで完了になります。気軽に取り組みましょう。',
  fallback: '各種目、ゆっくりていねいな動きを意識して行いましょう。呼吸を止めずに進めるのがコツです。'
};

/* date より前で直近のトレーニング日のキー（見つからなければ null）。 */
function previousTrainingKey(date) {
  var cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (var i = 0; i < 30; i++) {
    cursor.setDate(cursor.getDate() - 1);
    if (isTrainingRecordDay(dateKeyOf(cursor), cursor)) return dateKeyOf(cursor);
  }
  return null;
}

/* date の前日までの直近 days 日間で、トレーニング日のうち
   記録がある日と完了した日の数を数える。 */
function recentTrainingStats(date, days) {
  var recorded = 0;
  var complete = 0;
  var cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (var i = 0; i < days; i++) {
    cursor.setDate(cursor.getDate() - 1);
    if (!isTrainingRecordDay(dateKeyOf(cursor), cursor)) continue;
    var key = dateKeyOf(cursor);
    if (getRecord(key)) {
      recorded += 1;
      if (dayStats(key).complete) complete += 1;
    }
  }
  return { recorded: recorded, complete: complete };
}

/* アドバイスを1つ選ぶ決定的な関数。上から順に優先する。 */
function pickAdvice() {
  var date = todayDate();
  var key = dateKeyOf(date);

  /* 1. 今日が休みの日 */
  if (dayKindFor(key, date) === 'rest') return ADVICE_TEXTS.rest;

  /* 2. 今日がすでに完了 */
  if (dayStats(key).complete) return ADVICE_TEXTS.done;

  var hasRecords = Object.keys(state.records).length > 0;

  /* 3. 前回のトレーニング日が未完了で、今日はトレーニング日 */
  var prevKey = previousTrainingKey(date);
  if (hasRecords && prevKey && !dayStats(prevKey).complete) {
    return ADVICE_TEXTS.retryShort;
  }

  /* 4. 直近7日（トレーニング日のみ）の完了率が50%未満で、記録が3日以上ある */
  var recent = recentTrainingStats(date, 7);
  if (recent.recorded >= 3 && recent.complete / recent.recorded < 0.5) {
    return ADVICE_TEXTS.easeOff;
  }

  /* 5〜6. 連続日数 */
  var streak = calcStreak();
  if (streak >= 7) return ADVICE_TEXTS.streakLong;
  if (streak >= 3) return ADVICE_TEXTS.streak;

  /* 7. 記録がまだ無い */
  if (!hasRecords) return ADVICE_TEXTS.first;

  /* 8. 今日が短縮日 */
  if (effectiveShort(key, date)) return ADVICE_TEXTS.shortDay;

  /* 9. 既定 */
  return ADVICE_TEXTS.fallback;
}

// ===== DOM =====
var el = {};

function cacheElements() {
  el.todayDate = document.getElementById('today-date');
  el.todayStreak = document.getElementById('today-streak');
  el.todaySchedule = document.getElementById('today-schedule');
  el.adviceText = document.getElementById('advice-text');
  el.progressTrack = document.getElementById('progress-track');
  el.progressBar = document.getElementById('progress-bar');
  el.progressText = document.getElementById('progress-text');
  el.doneBanner = document.getElementById('done-banner');
  el.restBanner = document.getElementById('rest-banner');
  el.shortToggle = document.getElementById('short-toggle');
  el.todayList = document.getElementById('today-list');
  el.todayEmpty = document.getElementById('today-empty');
  el.manageList = document.getElementById('manage-list');
  el.addForm = document.getElementById('add-form');
  el.historyTotal = document.getElementById('history-total');
  el.historyList = document.getElementById('history-list');
  el.shortDays = document.getElementById('short-days');
  el.trainingDays = document.getElementById('training-days');
  el.timeSlot = document.getElementById('time-slot');
  el.timeValue = document.getElementById('time-value');
  el.exportBtn = document.getElementById('export-btn');
  el.importFile = document.getElementById('import-file');
  el.deleteAllBtn = document.getElementById('delete-all-btn');
  el.dataStatus = document.getElementById('data-status');
  el.liveRegion = document.getElementById('live-region');
  el.saveWarning = document.getElementById('save-warning');
  el.guideCard = document.getElementById('guide-card');
  el.guideClose = document.getElementById('guide-close');
  el.navToday = document.getElementById('nav-today');
  el.navMenu = document.getElementById('nav-menu');
  el.navMypage = document.getElementById('nav-mypage');
  el.navSettings = document.getElementById('nav-settings');
  el.viewToday = document.getElementById('view-today');
  el.viewMenu = document.getElementById('view-menu');
  el.viewMypage = document.getElementById('view-mypage');
  el.viewSettings = document.getElementById('view-settings');
  el.undoBar = document.getElementById('undo-bar');
  el.undoText = document.getElementById('undo-text');
  el.undoDeleteBtn = document.getElementById('undo-delete-btn');
  el.settingsStatus = document.getElementById('settings-status');
  el.lastExport = document.getElementById('last-export');
  el.restoreBackupBtn = document.getElementById('restore-backup-btn');
  el.gotoProfileBtn = document.getElementById('goto-profile-btn');
  el.guideReshowBtn = document.getElementById('guide-reshow-btn');
  el.settingsThemeBtn = document.getElementById('settings-theme-btn');
  el.mpYear = document.getElementById('mp-year');
  el.mpMonth = document.getElementById('mp-month');
  el.compareWeekPeriods = document.getElementById('compare-week-periods');
  el.compareWeekBody = document.getElementById('compare-week-body');
  el.compareMonthPeriods = document.getElementById('compare-month-periods');
  el.compareMonthBody = document.getElementById('compare-month-body');
  el.compareYearPeriods = document.getElementById('compare-year-periods');
  el.compareYearBody = document.getElementById('compare-year-body');
  el.chartNote = document.getElementById('chart-note');
  el.monthChart = document.getElementById('month-chart');
  el.totalDays = document.getElementById('total-days');
  el.totalLongestStreak = document.getElementById('total-longest-streak');
  el.totalCurrentStreak = document.getElementById('total-current-streak');
  el.totalSets = document.getElementById('total-sets');
  el.themeToggle = document.getElementById('theme-toggle');
  el.weekProgress = document.getElementById('week-progress');
  el.shareBtn = document.getElementById('share-btn');
  el.shareStatus = document.getElementById('share-status');
  el.weeklyGoal = document.getElementById('weekly-goal');
  el.mpWeek = document.getElementById('mp-week');
  el.calendarNote = document.getElementById('calendar-note');
  el.calendar = document.getElementById('calendar');
  el.exerciseTotals = document.getElementById('exercise-totals');
  el.exerciseTotalsEmpty = document.getElementById('exercise-totals-empty');
  el.cardExportBtn = document.getElementById('card-export-btn');
  el.cardCopyBtn = document.getElementById('card-copy-btn');
  el.cardStatus = document.getElementById('card-status');
  el.rivalFile = document.getElementById('rival-file');
  el.rivalStatus = document.getElementById('rival-status');
  el.rivalEmpty = document.getElementById('rival-empty');
  el.rivalCompare = document.getElementById('rival-compare');
  el.rivalSummary = document.getElementById('rival-summary');
  el.rivalThead = document.getElementById('rival-thead');
  el.rivalTbody = document.getElementById('rival-tbody');
  el.rivalList = document.getElementById('rival-list');
  el.profileImg = document.getElementById('profile-img');
  el.profileInitial = document.getElementById('profile-initial');
  el.profileName = document.getElementById('profile-name');
  el.profileBio = document.getElementById('profile-bio');
  el.profileNickname = document.getElementById('profile-nickname');
  el.profileBioInput = document.getElementById('profile-bio-input');
  el.profileBioCount = document.getElementById('profile-bio-count');
  el.profileImageFile = document.getElementById('profile-image-file');
  el.profileSaveBtn = document.getElementById('profile-save-btn');
  el.profileImageDeleteBtn = document.getElementById('profile-image-delete-btn');
  el.profileStatus = document.getElementById('profile-status');
}

function announce(message) {
  if (el.liveRegion) el.liveRegion.textContent = message;
}

function makeButton(className, text, ariaLabel) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

// ===== 描画: 今日 =====
function renderToday() {
  var date = todayDate();
  var key = dateKeyOf(date);
  var record = getRecord(key);
  var short = effectiveShort(key, date);
  var stats = dayStats(key);

  /* 初回の案内は、閉じるまで今日ビューの先頭に出す（#1） */
  if (el.guideCard) el.guideCard.hidden = state.prefs.guideDismissed;

  el.todayDate.textContent = formatDateJa(date);

  var streak = calcStreak();
  el.todayStreak.textContent = streak > 0 ? '連続 ' + streak + ' 日達成中' : '今日から始めましょう';

  /* 今週の進捗: 目標があれば「完了○日 / 目標○日」、無ければ残りのトレーニング日も添える */
  var weekProgress = weekProgressStats();
  if (state.settings.weeklyGoal > 0) {
    el.weekProgress.textContent = '今週の進捗: 完了' + weekProgress.done + '日 / 目標' + state.settings.weeklyGoal + '日' +
      (weekProgress.done >= state.settings.weeklyGoal ? '（目標達成！）' : '');
  } else {
    el.weekProgress.textContent = '今週の完了' + weekProgress.done + '日（今週のトレーニング日は残り' + weekProgress.remaining + '日）';
  }

  /* 今日の予定: その日の種別と時間設定を表示する */
  var kind = dayKindFor(key, date);
  if (kind === 'rest') {
    el.todaySchedule.textContent = '今日は休みの日です';
  } else {
    var scheduleText = '今日はトレーニングの日' + (kind === 'short' ? '（短縮）' : '');
    var timeText = timeTextFor();
    if (timeText) scheduleText += '・' + timeText;
    el.todaySchedule.textContent = scheduleText;
  }

  el.adviceText.textContent = pickAdvice();
  el.restBanner.hidden = kind !== 'rest';

  var rate = stats.totalTarget > 0 ? Math.round((stats.totalDone / stats.totalTarget) * 100) : 0;
  el.progressBar.style.width = rate + '%';
  el.progressTrack.setAttribute('aria-valuenow', String(rate));
  el.progressText.textContent = stats.totalDone + ' / ' + stats.totalTarget + ' セット完了（' + rate + '%）' +
    (short ? ' ・短縮モード中' : '');

  el.doneBanner.hidden = !stats.complete;

  el.shortToggle.checked = short;

  el.todayList.textContent = '';
  el.todayEmpty.hidden = state.exercises.length > 0;

  state.exercises.forEach(function (ex) {
    /* 今日の目標は、その日のスナップショット（素のセット数）を優先する（#25）。
       スナップショットがまだ無い種目は現在の設定から決める。 */
    var target;
    if (record && record.targets && typeof record.targets[ex.id] === 'number') {
      target = short ? Math.min(record.targets[ex.id], state.settings.shortGoalSets) : record.targets[ex.id];
    } else {
      target = targetSetsFor(ex, short);
    }
    var doneCount = record && record.done && typeof record.done[ex.id] === 'number' ? record.done[ex.id] : 0;
    doneCount = Math.min(doneCount, target);

    var li = document.createElement('li');
    li.className = 'exercise-row';

    var info = document.createElement('div');
    var name = document.createElement('h3');
    name.textContent = ex.name;
    var targetText = document.createElement('p');
    targetText.className = 'exercise-row__target';
    targetText.textContent = ex.amount + ex.unit + ' × ' + target + 'セット';
    info.appendChild(name);
    info.appendChild(targetText);
    if (ex.note) {
      var note = document.createElement('p');
      note.className = 'exercise-row__note';
      note.textContent = ex.note;
      /* 表示は1行に省略されるため、全文は title でも確認できるようにする */
      note.title = ex.note;
      info.appendChild(note);
    }
    li.appendChild(info);

    var setsWrap = document.createElement('div');
    setsWrap.className = 'exercise-row__sets';
    setsWrap.setAttribute('role', 'group');
    setsWrap.setAttribute('aria-label', ex.name + 'のセット完了チェック');

    for (var i = 0; i < target; i++) {
      (function (index) {
        var isDone = index < doneCount;
        /* 押せるのは「次にやるセット」と「最後に完了したセット（取り消し）」だけ（#7）。
           飛ばし押しはできない。 */
        var isNext = index === doneCount;
        var isUndoable = doneCount > 0 && index === doneCount - 1;
        var btn = makeButton(
          'set-toggle' + (isDone ? ' set-toggle--done' : '') + (isNext ? ' set-toggle--next' : ''),
          (index + 1) + 'セット目',
          ex.name + ' ' + (index + 1) + 'セット目を' + (isDone ? '未完了に戻す' : '完了にする') +
            (isNext && !isDone ? '（次はこれ）' : '')
        );
        btn.setAttribute('aria-pressed', isDone ? 'true' : 'false');
        btn.disabled = !(isNext || isUndoable);
        btn.addEventListener('click', function () {
          toggleSet(ex.id, index, short);
        });
        setsWrap.appendChild(btn);
      })(i);
    }
    li.appendChild(setsWrap);
    el.todayList.appendChild(li);
  });
}

function toggleSet(exerciseId, setIndex, short) {
  var record = ensureTodayRecord(short);
  var current = typeof record.done[exerciseId] === 'number' ? record.done[exerciseId] : 0;
  /* 飛ばし押しの防止（#7）: 次のセットか、最後に完了したセットの取り消しだけを受け付ける */
  if (setIndex > current) return;
  var next = setIndex < current ? setIndex : setIndex + 1;
  record.done[exerciseId] = next;
  saveRecords();
  renderToday();
  renderHistory();
  var ex = state.exercises.find(function (e) { return e.id === exerciseId; });
  announce((ex ? ex.name : '種目') + ' ' + (setIndex + 1) + 'セット目を' + (next > setIndex ? '完了にしました' : '未完了に戻しました'));
}

// ===== 描画: 種目の管理 =====
/* 編集中の種目ID（#9）。null のときは一覧表示。 */
var editingExerciseId = null;
/* 削除した種目の取り消し用（#10）。 */
var lastDeleted = null;
var undoTimer = null;

function hideUndoBar() {
  lastDeleted = null;
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  if (el.undoBar) el.undoBar.hidden = true;
}

function showUndoBar(ex, index) {
  lastDeleted = { exercise: ex, index: index };
  if (el.undoText) el.undoText.textContent = '「' + ex.name + '」を削除しました。';
  if (el.undoBar) el.undoBar.hidden = false;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoBar, 8000);
}

function deleteExercise(ex, index) {
  if (!window.confirm('「' + ex.name + '」を削除しますか？\n過去の記録は残りますが、今日以降のメニューからは消えます。')) {
    return;
  }
  state.exercises.splice(index, 1);
  if (editingExerciseId === ex.id) editingExerciseId = null;
  saveExercises();
  renderAll();
  showUndoBar(ex, index);
  announce(ex.name + 'を削除しました');
}

function undoDelete() {
  if (!lastDeleted) return;
  var item = lastDeleted;
  var at = Math.min(item.index, state.exercises.length);
  state.exercises.splice(at, 0, item.exercise);
  hideUndoBar();
  saveExercises();
  renderAll();
  announce(item.exercise.name + 'を元に戻しました');
}

function renderManage() {
  el.manageList.textContent = '';
  state.exercises.forEach(function (ex, index) {
    var li = document.createElement('li');
    li.className = 'manage-row';

    var name = document.createElement('p');
    name.className = 'manage-row__name';
    name.textContent = ex.name;
    li.appendChild(name);

    if (editingExerciseId === ex.id) {
      li.appendChild(buildExerciseEditForm(ex, index));
    } else {
      var summary = document.createElement('p');
      summary.className = 'manage-row__summary';
      summary.textContent = ex.amount + ex.unit + ' × ' + ex.sets + 'セット' +
        (ex.note ? '（' + ex.note + '）' : '');
      li.appendChild(summary);
    }

    var actions = document.createElement('div');
    actions.className = 'manage-row__actions';

    var upBtn = makeButton('btn btn--small', '↑ 上へ', ex.name + 'を上へ移動');
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', function () { moveExercise(index, -1); });
    actions.appendChild(upBtn);

    var downBtn = makeButton('btn btn--small', '↓ 下へ', ex.name + 'を下へ移動');
    downBtn.disabled = index === state.exercises.length - 1;
    downBtn.addEventListener('click', function () { moveExercise(index, 1); });
    actions.appendChild(downBtn);

    if (editingExerciseId !== ex.id) {
      var editBtn = makeButton('btn btn--small', '編集', ex.name + 'を編集');
      editBtn.addEventListener('click', function () {
        editingExerciseId = ex.id;
        renderManage();
      });
      actions.appendChild(editBtn);
    }

    var delBtn = makeButton('btn btn--small btn--danger manage-row__delete', '削除', ex.name + 'を削除');
    delBtn.addEventListener('click', function () { deleteExercise(ex, index); });
    actions.appendChild(delBtn);

    li.appendChild(actions);
    el.manageList.appendChild(li);
  });
}

/* 種目の編集フォーム（#9）: 名前・数値・単位・セット数・メモをまとめて編集し、
   保存／キャンセルで確定する。即時の数値入力は廃止した。 */
function buildExerciseEditForm(ex, index) {
  var form = document.createElement('form');
  form.className = 'edit-form';

  var grid = document.createElement('div');
  grid.className = 'form-grid';

  var fieldSeq = 0;
  function addField(labelText, input, wide) {
    fieldSeq += 1;
    var field = document.createElement('div');
    field.className = 'field' + (wide ? ' field--wide' : '');
    var label = document.createElement('label');
    label.className = 'field__label';
    label.textContent = labelText;
    input.id = 'edit-field-' + ex.id + '-' + fieldSeq;
    label.htmlFor = input.id;
    field.appendChild(label);
    field.appendChild(input);
    grid.appendChild(field);
    return input;
  }

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.maxLength = 40;
  nameInput.value = ex.name;
  addField('名前', nameInput, false);

  var amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.min = '1';
  amountInput.max = '999';
  amountInput.required = true;
  amountInput.value = String(ex.amount);
  addField('数値', amountInput, false);

  var unitSelect = document.createElement('select');
  ['回', '秒'].forEach(function (u) {
    var opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    if (ex.unit === u) opt.selected = true;
    unitSelect.appendChild(opt);
  });
  addField('単位', unitSelect, false);

  var setsInput = document.createElement('input');
  setsInput.type = 'number';
  setsInput.min = '1';
  setsInput.max = '10';
  setsInput.required = true;
  setsInput.value = String(ex.sets);
  addField('セット数', setsInput, false);

  var noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.maxLength = 80;
  noteInput.value = ex.note;
  addField('メモ（任意）', noteInput, true);

  form.appendChild(grid);

  var actions = document.createElement('div');
  actions.className = 'data-actions__row';
  var saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn--primary btn--small';
  saveBtn.textContent = '保存';
  actions.appendChild(saveBtn);
  var cancelBtn = makeButton('btn btn--small', 'キャンセル', ex.name + 'の編集をやめる');
  cancelBtn.addEventListener('click', function () {
    editingExerciseId = null;
    renderManage();
  });
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var cleaned = sanitizeExercise({
      id: ex.id,
      name: nameInput.value,
      amount: amountInput.value,
      unit: unitSelect.value,
      sets: setsInput.value,
      note: noteInput.value.trim()
    });
    if (!cleaned) {
      announce('名前を入力してください');
      return;
    }
    state.exercises[index] = cleaned;
    editingExerciseId = null;
    saveExercises();
    renderManage();
    renderToday();
    renderHistory();
    announce(cleaned.name + 'を保存しました');
  });

  return form;
}

function moveExercise(index, delta) {
  var next = index + delta;
  if (next < 0 || next >= state.exercises.length) return;
  var tmp = state.exercises[index];
  state.exercises[index] = state.exercises[next];
  state.exercises[next] = tmp;
  saveExercises();
  renderToday();
  renderManage();
}

// ===== 描画: 履歴 =====
/* 編集中の履歴の日付キー（#8）。null のときは通常表示。 */
var editingHistoryKey = null;

function renderHistory() {
  /* 累計の完了日数は、トレーニングの日の完了だけを数える */
  var totalComplete = 0;
  Object.keys(state.records).forEach(function (key) {
    if (isTrainingRecordDay(key, parseKey(key)) && dayStats(key).complete) totalComplete += 1;
  });
  el.historyTotal.textContent = '累計の完了日数: ' + totalComplete + '日';

  el.historyList.textContent = '';
  var cursor = todayDate();
  for (var i = 0; i < 14; i++) {
    var date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - i);
    var key = dateKeyOf(date);
    var stats = dayStats(key);
    var kind = dayKindFor(key, date);

    var li = document.createElement('li');
    li.className = 'history-row';

    var dateEl = document.createElement('span');
    dateEl.className = 'history-row__date';
    dateEl.textContent = formatDateJa(date);
    li.appendChild(dateEl);

    var badge = document.createElement('span');
    if (kind === 'rest') {
      /* 休みの日は未完了扱いにせず、完了率の対象からも外す */
      badge.className = 'badge badge--rest';
      badge.textContent = '休み';
    } else {
      badge.className = 'badge ' + (stats.complete ? 'badge--done' : 'badge--pending');
      badge.textContent = stats.complete ? '完了' : '未完了';
    }
    li.appendChild(badge);

    if (kind !== 'rest') {
      var rateEl = document.createElement('span');
      rateEl.className = 'history-row__rate';
      rateEl.textContent = '完了率 ' + stats.rate + '%' + (stats.short ? '（短縮）' : '');
      li.appendChild(rateEl);
    }

    /* 通常日・短縮日は内訳を出し、休みの日は記録がある分だけ出す */
    if (stats.entries.length > 0 && (kind !== 'rest' || stats.totalDone > 0)) {
      var detail = document.createElement('span');
      detail.className = 'history-row__detail';
      detail.textContent = stats.entries.map(function (e) {
        return e.name + ' ' + e.done + '/' + e.target;
      }).join('、');
      li.appendChild(detail);
    }

    /* 記録の編集（#8）: 目標のある種目が1つでもある日に「編集」を出す */
    var hasEditable = stats.entries.some(function (e) { return e.target > 0; });
    if (editingHistoryKey === key) {
      li.appendChild(buildHistoryEditForm(key, date, stats));
    } else if (hasEditable) {
      var editBtn = makeButton('btn btn--small', '編集', formatDateJa(date) + 'の記録を編集');
      (function (k) {
        editBtn.addEventListener('click', function () {
          editingHistoryKey = k;
          renderHistory();
        });
      })(key);
      li.appendChild(editBtn);
    }

    el.historyList.appendChild(li);
  }
}

/* 過去日の記録編集フォーム（#8）: その日のスナップショットをもとに、
   各種目の完了セット数を変更できる。 */
function buildHistoryEditForm(key, date, stats) {
  var wrap = document.createElement('div');
  wrap.className = 'history-edit';

  var inputs = {};
  stats.entries.forEach(function (entry) {
    if (entry.target <= 0) return;
    var row = document.createElement('div');
    row.className = 'history-edit__row';
    var nameEl = document.createElement('span');
    nameEl.className = 'history-edit__name';
    nameEl.textContent = entry.name;
    row.appendChild(nameEl);
    var input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(entry.target);
    input.value = String(entry.done);
    input.setAttribute('aria-label', entry.name + 'の完了セット数（目標' + entry.target + 'セット）');
    row.appendChild(input);
    var targetEl = document.createElement('span');
    targetEl.textContent = '/ ' + entry.target + 'セット';
    row.appendChild(targetEl);
    inputs[entry.id] = input;
    wrap.appendChild(row);
  });

  var actions = document.createElement('div');
  actions.className = 'data-actions__row';
  var saveBtn = makeButton('btn btn--primary btn--small', '保存', formatDateJa(date) + 'の記録を保存');
  saveBtn.addEventListener('click', function () {
    saveHistoryEdit(key, date, stats, inputs);
  });
  actions.appendChild(saveBtn);
  var cancelBtn = makeButton('btn btn--small', 'キャンセル', '編集をやめる');
  cancelBtn.addEventListener('click', function () {
    editingHistoryKey = null;
    renderHistory();
  });
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);
  return wrap;
}

function saveHistoryEdit(key, date, stats, inputs) {
  var record = getRecord(key);
  if (!record) {
    /* 記録が無い日に付け足す場合は、その日の種別を固定して新規作成する */
    record = {
      done: {},
      short: stats.short,
      dayType: isTrainingDay(date) ? 'training' : 'rest'
    };
    state.records[key] = record;
    writeSnapshot(record, stats.short);
  }
  if (typeof record.done !== 'object' || record.done === null) record.done = {};
  refreshSnapshot(record);
  Object.keys(inputs).forEach(function (id) {
    var entry = null;
    stats.entries.forEach(function (e) { if (e.id === id) entry = e; });
    var target = entry ? entry.target : 0;
    record.done[id] = toInt(inputs[id].value, 0, 0, target);
  });
  editingHistoryKey = null;
  saveRecords();
  renderAll();
  announce(formatDateJa(date) + 'の記録を保存しました');
}

// ===== 描画: 設定 =====
function renderSettings() {
  if (el.shortDays) {
    var shortBoxes = el.shortDays.querySelectorAll('input[name="short-day"]');
    shortBoxes.forEach(function (box) {
      box.checked = state.settings.shortWeekdays.indexOf(Number(box.value)) !== -1;
    });
  }
  if (el.trainingDays) {
    var trainingBoxes = el.trainingDays.querySelectorAll('input[name="training-day"]');
    trainingBoxes.forEach(function (box) {
      box.checked = state.settings.trainingWeekdays.indexOf(Number(box.value)) !== -1;
    });
  }
  if (el.timeSlot) el.timeSlot.value = state.settings.timeSlot;
  if (el.timeValue) el.timeValue.value = state.settings.timeValue;
  if (el.weeklyGoal) el.weeklyGoal.value = String(state.settings.weeklyGoal);
  /* 最後に書き出した日（#26）と、退避データの有無 */
  if (el.lastExport) {
    el.lastExport.textContent = state.prefs.exportLastAt !== ''
      ? '最後に書き出した日: ' + state.prefs.exportLastAt
      : 'まだ書き出していません。';
  }
  if (el.restoreBackupBtn) {
    el.restoreBackupBtn.hidden = !hasBackup();
  }
}

/* 設定を変えたときに「保存しました」を短時間出す（#13）。 */
var savedNoteTimer = null;
function notifySaved() {
  if (!el.settingsStatus) return;
  el.settingsStatus.textContent = '保存しました';
  if (savedNoteTimer) clearTimeout(savedNoteTimer);
  savedNoteTimer = setTimeout(function () {
    if (el.settingsStatus) el.settingsStatus.textContent = '';
    savedNoteTimer = null;
  }, 2500);
}

/* インポート前に退避したデータがあるか（#26）。 */
function hasBackup() {
  try {
    return localStorage.getItem(STORAGE_KEYS.backup) !== null;
  } catch (e) {
    return false;
  }
}

/* 現在のデータを、インポート前の退避用キーに保存する（#26）。 */
function stashBackup() {
  try {
    localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      exercises: state.exercises,
      records: state.records,
      settings: state.settings,
      profile: state.profile,
      rivals: state.rivals
    }));
    return true;
  } catch (e) {
    return false;
  }
}

// ===== 描画: マイページ =====
/* 期間選択の状態。初期値は prefs に保存された前回の選択（#16）、
   無ければ今の年・月・週。 */
var mypageSel = { year: null, month: null, weekMonday: null };
var currentView = 'today';

function initMypageSel() {
  var today = todayDate();
  mypageSel.year = typeof state.prefs.mpYear === 'number' ? state.prefs.mpYear : today.getFullYear();
  mypageSel.month = typeof state.prefs.mpMonth === 'number' ? state.prefs.mpMonth : today.getMonth();
  mypageSel.weekMonday = state.prefs.mpWeek !== '' ? mondayFromWeekValue(state.prefs.mpWeek) : null;
}

function persistMypageSel() {
  state.prefs.mpYear = mypageSel.year;
  state.prefs.mpMonth = mypageSel.month;
  state.prefs.mpWeek = mypageSel.weekMonday ? isoWeekValue(mypageSel.weekMonday) : '';
  savePrefs();
}

function formatShortDate(date) {
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

/* 比較表の1行を作る */
function compareRow(label, curText, prevText, diffText) {
  var tr = document.createElement('tr');
  var th = document.createElement('th');
  th.scope = 'row';
  th.textContent = label;
  tr.appendChild(th);
  [curText, prevText, diffText].forEach(function (text) {
    var td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  });
  return tr;
}

/* 比較表に4指標（完了日数・完了率・完了セット数・合計回数）を入れる。
   記録が無い期間は数値の代わりに「データなし」と出し、差は「—」にする。 */
function fillCompare(tbody, cur, prev) {
  tbody.textContent = '';

  function sideText(stats, text) {
    return stats.hasData ? text : 'データなし';
  }
  function diffText(curVal, prevVal, suffix) {
    if (!cur.hasData || !prev.hasData || curVal === null || prevVal === null) return '—';
    var d = curVal - prevVal;
    return (d > 0 ? '+' : '') + d + suffix;
  }
  function rateText(stats) {
    return stats.rate === null ? '—' : stats.rate + '%';
  }
  function repsText(stats) {
    return stats.repsKnown ? stats.reps + '回' : '—';
  }
  function repsVal(stats) {
    return stats.repsKnown ? stats.reps : null;
  }

  tbody.appendChild(compareRow('完了日数',
    sideText(cur, cur.completeDays + '日'),
    sideText(prev, prev.completeDays + '日'),
    diffText(cur.completeDays, prev.completeDays, '日')));
  tbody.appendChild(compareRow('完了率',
    sideText(cur, rateText(cur)),
    sideText(prev, rateText(prev)),
    diffText(cur.rate, prev.rate, '%')));
  tbody.appendChild(compareRow('完了セット数',
    sideText(cur, cur.sets + 'セット'),
    sideText(prev, prev.sets + 'セット'),
    diffText(cur.sets, prev.sets, 'セット')));
  tbody.appendChild(compareRow('合計回数',
    sideText(cur, repsText(cur)),
    sideText(prev, repsText(prev)),
    diffText(repsVal(cur), repsVal(prev), '回')));
}

function renderMypage() {
  renderProfile();
  var today = todayDate();
  if (mypageSel.year === null) {
    mypageSel.year = today.getFullYear();
    mypageSel.month = today.getMonth();
  }

  /* 年セレクト: 記録がある最も古い年〜今年（記録が無ければ今年のみ） */
  var oldest = oldestRecordYear();
  var firstYear = oldest === null ? today.getFullYear() : Math.min(oldest, today.getFullYear());
  if (mypageSel.year < firstYear) mypageSel.year = firstYear;
  if (mypageSel.year > today.getFullYear()) mypageSel.year = today.getFullYear();
  el.mpYear.textContent = '';
  for (var y = firstYear; y <= today.getFullYear(); y++) {
    var opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = y + '年';
    el.mpYear.appendChild(opt);
  }
  el.mpYear.value = String(mypageSel.year);
  el.mpMonth.value = String(mypageSel.month);

  var selYear = mypageSel.year;
  var selMonth = mypageSel.month;

  /* 週の比較: 選んだ週 vs その前週（週は月曜はじまり）。
     週の選択が無い・読めない場合は今週として扱う。 */
  var selMonday = mypageSel.weekMonday || startOfWeekMonday(today);
  var selSunday = addDays(selMonday, 6);
  var prevMonday = addDays(selMonday, -7);
  var prevSunday = addDays(selMonday, -1);
  el.mpWeek.value = isoWeekValue(selMonday);
  el.compareWeekPeriods.textContent =
    formatShortDate(selMonday) + '〜' + formatShortDate(selSunday) + ' と ' +
    formatShortDate(prevMonday) + '〜' + formatShortDate(prevSunday) + ' の比較';
  fillCompare(el.compareWeekBody, periodStats(selMonday, selSunday), periodStats(prevMonday, prevSunday));

  /* 月の比較: 選んだ月 vs その前月 */
  var monthStart = new Date(selYear, selMonth, 1);
  var monthEnd = new Date(selYear, selMonth + 1, 0);
  var prevMonthStart = new Date(selYear, selMonth - 1, 1);
  var prevMonthEnd = new Date(selYear, selMonth, 0);
  el.compareMonthPeriods.textContent =
    selYear + '年' + (selMonth + 1) + '月 と ' +
    prevMonthStart.getFullYear() + '年' + (prevMonthStart.getMonth() + 1) + '月 の比較';
  fillCompare(el.compareMonthBody,
    periodStats(monthStart, monthEnd), periodStats(prevMonthStart, prevMonthEnd));

  /* 年の比較: 選んだ年 vs その前年 */
  el.compareYearPeriods.textContent = selYear + '年 と ' + (selYear - 1) + '年 の比較';
  fillCompare(el.compareYearBody,
    periodStats(new Date(selYear, 0, 1), new Date(selYear, 11, 31)),
    periodStats(new Date(selYear - 1, 0, 1), new Date(selYear - 1, 11, 31)));

  /* 月別グラフ: 選んだ年の12か月分の完了日数 */
  el.chartNote.textContent = selYear + '年の月ごとの完了日数です。棒の長さは、その年でいちばん多い月に合わせています。数字が正確な値です。';
  var monthCounts = [];
  var maxCount = 0;
  for (var m = 0; m < 12; m++) {
    var s = periodStats(new Date(selYear, m, 1), new Date(selYear, m + 1, 0));
    monthCounts.push(s.completeDays);
    if (s.completeDays > maxCount) maxCount = s.completeDays;
  }
  el.monthChart.textContent = '';
  monthCounts.forEach(function (count, idx) {
    var li = document.createElement('li');
    li.className = 'bar-row';
    var label = document.createElement('span');
    label.className = 'bar-row__label';
    label.textContent = selYear + '年' + (idx + 1) + '月';
    var track = document.createElement('span');
    track.className = 'bar-row__track';
    var bar = document.createElement('span');
    bar.className = 'bar-row__bar';
    bar.style.width = maxCount > 0 ? Math.round((count / maxCount) * 100) + '%' : '0%';
    track.appendChild(bar);
    var value = document.createElement('span');
    value.className = 'bar-row__value';
    value.textContent = count + '日';
    li.appendChild(label);
    li.appendChild(track);
    li.appendChild(value);
    el.monthChart.appendChild(li);
  });

  /* 累計 */
  var allTotals = allTimeTotals();
  el.totalDays.textContent = allTotals.totalDays + '日';
  el.totalLongestStreak.textContent = calcLongestStreak() + '日';
  el.totalCurrentStreak.textContent = calcStreak() + '日';
  el.totalSets.textContent = allTotals.totalSets + 'セット';

  renderCalendar(selYear, selMonth);
  renderExerciseTotals();
  renderRivals();
}

// ===== プロフィール（マイページ） =====
/* プロフィール画像を読み込み、canvas で最大256×256に縮小して data URL 化する。
   PNGで収まればそのまま、大きければ JPEG の品質を段階的に落として再圧縮する。
   それでも上限を超える場合は error を返す。done(dataUrl, errorMessage) で通知。 */
function processProfileImage(file, done) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      try {
        var scale = Math.min(1, PROFILE_IMAGE_MAX_PX / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var dataUrl = '';
        if (file.type === 'image/png') {
          dataUrl = canvas.toDataURL('image/png');
        }
        if (dataUrl === '' || dataUrl.length > PROFILE_IMAGE_TARGET_LENGTH) {
          var qualities = [0.85, 0.7, 0.55, 0.4, 0.3];
          for (var i = 0; i < qualities.length; i++) {
            dataUrl = canvas.toDataURL('image/jpeg', qualities[i]);
            if (dataUrl.length <= PROFILE_IMAGE_TARGET_LENGTH) break;
          }
        }
        if (dataUrl.length > PROFILE_IMAGE_MAX_LENGTH) {
          done(null, '画像が大きすぎるため保存できませんでした。もう少し小さい画像を選んでください。');
          return;
        }
        done(dataUrl, null);
      } catch (e) {
        done(null, '画像を処理できませんでした。別の画像を選んでください。');
      }
    };
    img.onerror = function () {
      done(null, '画像を読み込めませんでした。別の画像を選んでください。');
    };
    img.src = String(reader.result);
  };
  reader.onerror = function () {
    done(null, '画像を読み込めませんでした。');
  };
  reader.readAsDataURL(file);
}

/* プロフィールカードの表示（画像・ニックネーム・紹介文）と、
   編集中の入力欄への反映（入力中の欄は上書きしない）。 */
function renderProfile() {
  var name = displayNickname();
  el.profileName.textContent = name;
  el.profileBio.textContent = state.profile.bio !== '' ? state.profile.bio : '紹介文はまだありません。';

  var hasImage = state.profile.image !== '';
  el.profileImg.hidden = !hasImage;
  if (hasImage) {
    el.profileImg.src = state.profile.image;
  } else {
    el.profileImg.removeAttribute('src');
  }
  el.profileInitial.hidden = hasImage;
  el.profileInitial.textContent = name.charAt(0);
  el.profileImageDeleteBtn.hidden = !hasImage;

  if (document.activeElement !== el.profileNickname) {
    el.profileNickname.value = state.settings.nickname;
  }
  if (document.activeElement !== el.profileBioInput) {
    el.profileBioInput.value = state.profile.bio;
    el.profileBioCount.textContent = String(state.profile.bio.length);
  }
}

// ===== 対戦カード（友達と競争・オフライン） =====
var RIVAL_MAX = 5;

var RIVAL_METRICS = [
  { key: 'streak', label: '現在の連続日数', suffix: '日' },
  { key: 'bestStreak', label: '最長連続日数', suffix: '日' },
  { key: 'weekDone', label: '今週の完了日数', suffix: '日' },
  { key: 'totalDays', label: '総完了日数', suffix: '日' },
  { key: 'totalSets', label: '総完了セット数', suffix: 'セット' },
  { key: 'totalReps', label: '合計回数', suffix: '回' }
];

/* 自分の対戦カードを作る。集計はスナップショットベースなので、
   種目を削除・変更しても壊れない。
   ニックネーム・紹介文・プロフィール画像も含まれ、書き出して共有した相手に渡る。
   端末の外に出るのは、この書き出し・共有のときだけ。 */
function buildOwnCard() {
  var totals = allTimeTotals();
  return {
    type: 'daily-training-card',
    version: 1,
    cardId: state.settings.cardId,
    nickname: displayNickname(),
    bio: state.profile.bio,
    image: state.profile.image !== '' ? state.profile.image : null,
    generatedAt: dateKeyOf(todayDate()),
    streak: calcStreak(),
    bestStreak: calcLongestStreak(),
    weekDone: weekProgressStats().done,
    totalDays: totals.totalDays,
    totalSets: totals.totalSets,
    totalReps: totals.totalReps
  };
}

/* 取り込んだ対戦カードを検証して整える。形式が違う場合は null。 */
function sanitizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== 'daily-training-card' || raw.version !== 1) return null;
  return {
    type: 'daily-training-card',
    version: 1,
    /* カード固有ID（#18）。無い旧形式カードでは '' になり、照合はニックネームで行う */
    cardId: typeof raw.cardId === 'string' ? raw.cardId.slice(0, 64) : '',
    nickname: typeof raw.nickname === 'string' && raw.nickname.trim() !== '' ? raw.nickname.trim().slice(0, 20) : '友達',
    /* 紹介文と画像は任意項目。無い旧形式カードも取り込めるようにする */
    bio: typeof raw.bio === 'string' ? raw.bio.slice(0, PROFILE_BIO_MAX) : '',
    image: typeof raw.image === 'string' && raw.image.indexOf('data:image/') === 0 &&
      raw.image.length <= PROFILE_IMAGE_MAX_LENGTH ? raw.image : null,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 10) : '',
    streak: toInt(raw.streak, 0, 0, 100000000),
    bestStreak: toInt(raw.bestStreak, 0, 0, 100000000),
    weekDone: toInt(raw.weekDone, 0, 0, 100000000),
    totalDays: toInt(raw.totalDays, 0, 0, 100000000),
    totalSets: toInt(raw.totalSets, 0, 0, 100000000),
    totalReps: toInt(raw.totalReps, 0, 0, 100000000)
  };
}

/* 記録の日付キーとして正しいか（形式と実在する日付か） */
function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  var parts = key.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/* インポートするデータ全体を、読み込む前に検証する（#22, #27, #28）。
   問題があれば { ok: false, error: 理由 } を返し、その場合は読み込まない。
   問題がなければ整形済みのデータ { ok: true, data } を返す。
   整形には既存の sanitize 系を使うが、検証はそれより厳しく
   「型が違う・範囲外」を落とす。 */
function validateImportData(parsed) {
  function fail(message) { return { ok: false, error: message }; }

  if (!isPlainObject(parsed)) {
    return fail('データの形式が違います（JSONのオブジェクトではありません）。');
  }
  if (parsed.schemaVersion !== undefined) {
    if (typeof parsed.schemaVersion !== 'number' || !isFinite(parsed.schemaVersion)) {
      return fail('schemaVersion の形式が違います。');
    }
    if (parsed.schemaVersion > SCHEMA_VERSION) {
      return fail('このファイルは新しい形式（schemaVersion ' + parsed.schemaVersion +
        '）で作られています。このアプリ（schemaVersion ' + SCHEMA_VERSION + '）では読み込めません。');
    }
  }

  /* exercises: 配列で、各要素に名前と数値があること */
  if (!Array.isArray(parsed.exercises)) {
    return fail('exercises が配列ではありません。');
  }
  if (parsed.exercises.length > FILE_LIMITS.exercisesMax) {
    return fail('種目が多すぎます（最大' + FILE_LIMITS.exercisesMax + '件）。');
  }
  for (var i = 0; i < parsed.exercises.length; i++) {
    var rawEx = parsed.exercises[i];
    if (!isPlainObject(rawEx)) return fail('種目 ' + (i + 1) + ' 件目の形式が違います。');
    if (typeof rawEx.name !== 'string' || rawEx.name.trim() === '') {
      return fail('種目 ' + (i + 1) + ' 件目に名前がありません。');
    }
    if (typeof rawEx.amount !== 'number' || !isFinite(rawEx.amount)) {
      return fail('種目「' + rawEx.name + '」の数値が正しくありません。');
    }
    if (rawEx.unit !== undefined && rawEx.unit !== '回' && rawEx.unit !== '秒') {
      return fail('種目「' + rawEx.name + '」の単位が正しくありません。');
    }
    if (rawEx.sets !== undefined && (typeof rawEx.sets !== 'number' || !isFinite(rawEx.sets))) {
      return fail('種目「' + rawEx.name + '」のセット数が正しくありません。');
    }
    if (rawEx.note !== undefined && typeof rawEx.note !== 'string') {
      return fail('種目「' + rawEx.name + '」のメモの形式が違います。');
    }
    if (rawEx.id !== undefined && typeof rawEx.id !== 'string') {
      return fail('種目「' + rawEx.name + '」のIDの形式が違います。');
    }
  }

  /* records: 日付キーのオブジェクトで、完了セット数が範囲内であること */
  if (!isPlainObject(parsed.records)) {
    return fail('records がオブジェクトではありません。');
  }
  var recordKeys = Object.keys(parsed.records);
  for (var r = 0; r < recordKeys.length; r++) {
    var key = recordKeys[r];
    if (!isValidDateKey(key)) {
      return fail('記録の日付「' + key + '」の形式が正しくありません。');
    }
    var rec = parsed.records[key];
    if (!isPlainObject(rec)) return fail(key + ' の記録の形式が違います。');
    if (rec.done !== undefined) {
      if (!isPlainObject(rec.done)) return fail(key + ' の完了記録の形式が違います。');
      var doneIds = Object.keys(rec.done);
      for (var d = 0; d < doneIds.length; d++) {
        var dv = rec.done[doneIds[d]];
        if (typeof dv !== 'number' || !isFinite(dv) || dv < 0 || dv > 999 || Math.floor(dv) !== dv) {
          return fail(key + ' の完了セット数が範囲外です。');
        }
      }
    }
    if (rec.short !== undefined && typeof rec.short !== 'boolean') {
      return fail(key + ' の短縮フラグの形式が違います。');
    }
    if (rec.dayType !== undefined && rec.dayType !== 'training' && rec.dayType !== 'rest') {
      return fail(key + ' の日種別の形式が違います。');
    }
    var snapFields = ['targets', 'names', 'amounts', 'units'];
    for (var s = 0; s < snapFields.length; s++) {
      if (rec[snapFields[s]] !== undefined && !isPlainObject(rec[snapFields[s]])) {
        return fail(key + ' の ' + snapFields[s] + ' の形式が違います。');
      }
    }
  }

  /* settings / profile / rivals: 型の検証 */
  if (parsed.settings !== undefined && !isPlainObject(parsed.settings)) {
    return fail('settings の形式が違います。');
  }
  if (parsed.profile !== undefined) {
    if (!isPlainObject(parsed.profile)) return fail('profile の形式が違います。');
    if (parsed.profile.image !== undefined &&
        (typeof parsed.profile.image !== 'string' || parsed.profile.image.length > PROFILE_IMAGE_MAX_LENGTH ||
         (parsed.profile.image !== '' && parsed.profile.image.indexOf('data:image/') !== 0))) {
      return fail('プロフィール画像の形式が正しくありません。');
    }
    if (parsed.profile.bio !== undefined && typeof parsed.profile.bio !== 'string') {
      return fail('紹介文の形式が違います。');
    }
  }
  if (parsed.rivals !== undefined) {
    if (!Array.isArray(parsed.rivals)) return fail('rivals の形式が違います。');
    if (parsed.rivals.length > FILE_LIMITS.rivalsMax) {
      return fail('友達のカードが多すぎます（最大' + FILE_LIMITS.rivalsMax + '人）。');
    }
    for (var v = 0; v < parsed.rivals.length; v++) {
      if (!sanitizeCard(parsed.rivals[v])) {
        return fail('友達のカード ' + (v + 1) + ' 件目の形式が正しくありません。');
      }
    }
  }

  /* 検証を通ったので、既存の sanitize で整形する */
  var exercises = [];
  parsed.exercises.forEach(function (raw) {
    var ex = sanitizeExercise(raw);
    if (ex) exercises.push(ex);
  });
  var rivals = null;
  if (parsed.rivals !== undefined) {
    rivals = [];
    parsed.rivals.forEach(function (raw) {
      var card = sanitizeCard(raw);
      if (card) rivals.push(card);
    });
  }
  return {
    ok: true,
    data: {
      exercises: exercises,
      records: clone(parsed.records),
      settings: sanitizeSettings(parsed.settings),
      /* プロフィール・友達が無い旧形式の書き出しでは null（＝今のものを保持） */
      profile: parsed.profile !== undefined ? sanitizeProfile(parsed.profile) : null,
      rivals: rivals
    }
  };
}
function renderRivals() {
  var own = buildOwnCard();
  var people = [own].concat(state.rivals);
  var hasRivals = state.rivals.length > 0;

  el.rivalEmpty.hidden = hasRivals;
  el.rivalCompare.hidden = !hasRivals;

  /* 勝敗サマリー: 友達ごとに、6指標での勝ち・負け・引き分けを数える */
  el.rivalSummary.textContent = '';
  state.rivals.forEach(function (rival) {
    var wins = 0;
    var losses = 0;
    var draws = 0;
    RIVAL_METRICS.forEach(function (metric) {
      if (own[metric.key] > rival[metric.key]) wins += 1;
      else if (own[metric.key] < rival[metric.key]) losses += 1;
      else draws += 1;
    });
    var line = document.createElement('p');
    line.className = 'rival-summary__line';
    line.textContent = rival.nickname + 'さんとの勝敗: ' + wins + '勝' + losses + '敗' +
      (draws > 0 ? '・' + draws + '分け' : '');
    el.rivalSummary.appendChild(line);
  });

  /* 比較表: 行が指標、列が人。各指標のトップには ★ と色を付ける */
  el.rivalThead.textContent = '';
  var headRow = document.createElement('tr');
  var thFirst = document.createElement('th');
  thFirst.scope = 'col';
  thFirst.textContent = '指標';
  headRow.appendChild(thFirst);
  people.forEach(function (person) {
    var th = document.createElement('th');
    th.scope = 'col';
    th.textContent = person.nickname;
    headRow.appendChild(th);
  });
  el.rivalThead.appendChild(headRow);

  el.rivalTbody.textContent = '';
  RIVAL_METRICS.forEach(function (metric) {
    var max = Math.max.apply(null, people.map(function (p) { return p[metric.key]; }));
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = metric.label;
    tr.appendChild(th);
    people.forEach(function (person) {
      var td = document.createElement('td');
      var isTop = hasRivals && person[metric.key] === max;
      td.textContent = person[metric.key] + metric.suffix + (isTop ? ' ★' : '');
      if (isTop) td.className = 'rival-table__top';
      tr.appendChild(td);
    });
    el.rivalTbody.appendChild(tr);
  });

  /* 友達リスト（プロフィール画像・紹介文・削除ボタン付き） */
  el.rivalList.textContent = '';
  state.rivals.forEach(function (rival, index) {
    var li = document.createElement('li');
    li.className = 'rival-list__row';

    var main = document.createElement('div');
    main.className = 'rival-list__main';

    var avatar = document.createElement('span');
    avatar.className = 'rival-list__avatar';
    if (rival.image) {
      var avatarImg = document.createElement('img');
      avatarImg.className = 'rival-list__avatar-img';
      avatarImg.src = rival.image;
      avatarImg.alt = '';
      avatar.appendChild(avatarImg);
    } else {
      avatar.textContent = rival.nickname.charAt(0);
    }
    main.appendChild(avatar);

    var texts = document.createElement('div');
    var info = document.createElement('span');
    info.className = 'rival-list__info';
    info.textContent = rival.nickname + '（' + (rival.generatedAt !== '' ? rival.generatedAt : '日付不明') + 'のカード）';
    texts.appendChild(info);
    if (rival.bio) {
      var bio = document.createElement('p');
      bio.className = 'rival-list__bio';
      bio.textContent = rival.bio;
      texts.appendChild(bio);
    }
    main.appendChild(texts);
    li.appendChild(main);

    var delBtn = makeButton('btn btn--small btn--danger', '削除', rival.nickname + 'さんのカードを削除');
    delBtn.addEventListener('click', function () {
      state.rivals.splice(index, 1);
      saveRivals();
      renderRivals();
      el.rivalStatus.textContent = rival.nickname + 'さんのカードを削除しました。';
      announce(rival.nickname + 'さんのカードを削除しました');
    });
    li.appendChild(delBtn);
    el.rivalList.appendChild(li);
  });
}

/* カレンダー: 選んだ年・月の月カレンダー（月曜はじまり、表示専用）。
   状態は色だけでなく記号でも区別する（凡例はHTML側に置いてある）。 */
function renderCalendar(year, month) {
  el.calendarNote.textContent = year + '年' + (month + 1) + '月のカレンダーです。';
  el.calendar.textContent = '';

  var today = todayDate();
  var first = new Date(year, month, 1);
  var startOffset = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var table = document.createElement('table');
  table.className = 'calendar';

  var thead = document.createElement('thead');
  var headRow = document.createElement('tr');
  ['月', '火', '水', '木', '金', '土', '日'].forEach(function (label) {
    var th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var dayNum = 1;
  for (var row = 0; row < 6 && dayNum <= daysInMonth; row++) {
    var tr = document.createElement('tr');
    for (var col = 0; col < 7; col++) {
      var td = document.createElement('td');
      if ((row === 0 && col < startOffset) || dayNum > daysInMonth) {
        td.className = 'calendar__cell--blank';
      } else {
        var date = new Date(year, month, dayNum);
        var key = dateKeyOf(date);
        var stats = dayStats(key);
        var kind = dayKindFor(key, date);
        var statusText;
        var markText = '';
        if (date > today) {
          statusText = 'まだ先の日付です';
        } else if (stats.complete && kind === 'short') {
          statusText = '短縮で完了';
          markText = '✓短';
          td.classList.add('calendar__cell--done');
        } else if (stats.complete) {
          statusText = '完了';
          markText = '✓';
          td.classList.add('calendar__cell--done');
        } else if (kind === 'rest') {
          statusText = '休みの日';
          markText = '休';
          td.classList.add('calendar__cell--rest');
        } else {
          statusText = '未完了';
          markText = '−';
        }
        if (key === dateKeyOf(today)) {
          td.classList.add('calendar__cell--today');
          statusText += '（今日）';
        }
        td.setAttribute('aria-label', formatDateJa(date) + ' ' + statusText);
        var num = document.createElement('span');
        num.className = 'calendar__day-num';
        num.textContent = String(dayNum);
        td.appendChild(num);
        if (markText) {
          var mark = document.createElement('span');
          mark.className = 'calendar__mark';
          mark.textContent = markText;
          td.appendChild(mark);
        }
        dayNum += 1;
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  el.calendar.appendChild(table);
}

/* 種目別の累計リスト（完了セット数の多い順） */
function renderExerciseTotals() {
  var totals = exerciseTotals();
  el.exerciseTotals.textContent = '';
  el.exerciseTotalsEmpty.hidden = totals.length > 0;
  totals.forEach(function (t) {
    var li = document.createElement('li');
    li.className = 'ex-totals__row';
    var name = document.createElement('span');
    name.className = 'ex-totals__name';
    name.textContent = t.name;
    var value = document.createElement('span');
    value.className = 'ex-totals__value';
    value.textContent = t.sets + 'セット' + (t.repsKnown ? '・合計' + t.reps + '回' : '');
    li.appendChild(name);
    li.appendChild(value);
    el.exerciseTotals.appendChild(li);
  });
}

/* ビュー切替: 「今日」「メニュー」「マイページ」「設定」の4つ（#2）。
   URLハッシュ（#menu など）でも開ける。 */
var VIEW_NAMES = ['today', 'menu', 'mypage', 'settings'];

function showView(view) {
  currentView = VIEW_NAMES.indexOf(view) !== -1 ? view : 'today';
  var views = { today: el.viewToday, menu: el.viewMenu, mypage: el.viewMypage, settings: el.viewSettings };
  var navs = { today: el.navToday, menu: el.navMenu, mypage: el.navMypage, settings: el.navSettings };
  VIEW_NAMES.forEach(function (name) {
    var isActive = name === currentView;
    if (views[name]) views[name].hidden = !isActive;
    if (navs[name]) {
      navs[name].classList.toggle('view-nav__btn--active', isActive);
      if (isActive) navs[name].setAttribute('aria-current', 'page');
      else navs[name].removeAttribute('aria-current');
    }
  });
  if (currentView === 'mypage') renderMypage();
  try {
    history.replaceState(null, '', '#' + currentView);
  } catch (e) { /* ハッシュ更新ができなくても表示は切り替える */ }
}

function renderAll() {
  renderToday();
  renderManage();
  renderHistory();
  renderSettings();
  if (currentView === 'mypage') renderMypage();
}

/* 折りたたみUI: 見出しボタン（aria-expanded）と本文を対応づける。
   初期状態は閉。開閉状態はセッション内のみで、保存はしない。 */
function setupCollapse(toggleId, bodyId) {
  var toggle = document.getElementById(toggleId);
  var body = document.getElementById(bodyId);
  if (!toggle || !body) return;
  toggle.addEventListener('click', function () {
    var open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    body.hidden = open;
  });
}

// ===== イベント =====
function initEvents() {
  /* 折りたたみ（今日: アドバイス／共有／履歴、マイページ: 月別グラフ／種目別累計／友達と競争） */
  setupCollapse('toggle-advice', 'advice-body');
  setupCollapse('toggle-share', 'share-body');
  setupCollapse('toggle-history', 'history-body');
  setupCollapse('toggle-chart', 'chart-body');
  setupCollapse('toggle-extotals', 'extotals-body');
  setupCollapse('toggle-rivals', 'rivals-body');

  var navLabels = { today: '今日', menu: 'メニュー', mypage: 'マイページ', settings: '設定' };
  var navEls = { today: el.navToday, menu: el.navMenu, mypage: el.navMypage, settings: el.navSettings };
  VIEW_NAMES.forEach(function (name) {
    if (!navEls[name]) return;
    navEls[name].addEventListener('click', function () {
      showView(name);
      announce(navLabels[name] + 'の画面を表示しました');
    });
  });

  window.addEventListener('hashchange', function () {
    var hash = window.location.hash.replace('#', '');
    /* ビュー名のハッシュだけをビュー切替として扱う。
       ページ内リンク（#sec-xxx など）は通常のアンカーとして動かす。 */
    if (VIEW_NAMES.indexOf(hash) !== -1 && hash !== currentView) showView(hash);
  });

  /* 初回の案内（#1）: 閉じる／設定から再表示 */
  if (el.guideClose) {
    el.guideClose.addEventListener('click', function () {
      state.prefs.guideDismissed = true;
      savePrefs();
      renderToday();
      announce('案内を閉じました');
    });
  }
  if (el.guideReshowBtn) {
    el.guideReshowBtn.addEventListener('click', function () {
      state.prefs.guideDismissed = false;
      savePrefs();
      showView('today');
      renderToday();
      announce('初回の案内を表示しました');
    });
  }

  /* ニックネームはプロフィールに一本化（#20）: 設定からはプロフィールへ誘導する */
  if (el.gotoProfileBtn) {
    el.gotoProfileBtn.addEventListener('click', function () {
      showView('mypage');
      if (el.profileNickname) el.profileNickname.focus();
    });
  }

  if (el.undoDeleteBtn) {
    el.undoDeleteBtn.addEventListener('click', undoDelete);
  }

  el.mpYear.addEventListener('change', function () {
    mypageSel.year = toInt(el.mpYear.value, todayDate().getFullYear(), 1, 9999);
    persistMypageSel();
    renderMypage();
  });

  el.mpMonth.addEventListener('change', function () {
    mypageSel.month = toInt(el.mpMonth.value, todayDate().getMonth(), 0, 11);
    persistMypageSel();
    renderMypage();
  });

  el.mpWeek.addEventListener('change', function () {
    /* 値が読めない環境では null になり、今週として扱われる */
    mypageSel.weekMonday = mondayFromWeekValue(el.mpWeek.value);
    persistMypageSel();
    renderMypage();
  });

  function toggleTheme() {
    state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
    notifySaved();
    announce(state.settings.theme === 'dark' ? 'ダークモードにしました' : 'ライトモードにしました');
  }
  el.themeToggle.addEventListener('click', toggleTheme);
  if (el.settingsThemeBtn) el.settingsThemeBtn.addEventListener('click', toggleTheme);

  el.weeklyGoal.addEventListener('change', function () {
    state.settings.weeklyGoal = toInt(el.weeklyGoal.value, 0, 0, 7);
    el.weeklyGoal.value = String(state.settings.weeklyGoal);
    saveSettings();
    notifySaved();
    renderToday();
    announce('1週間の目標を変更しました');
  });

  el.profileSaveBtn.addEventListener('click', function () {
    /* ニックネームは設定側と同じ保存先（settings.nickname）に書く */
    state.settings.nickname = el.profileNickname.value.trim().slice(0, 20);
    state.profile.bio = el.profileBioInput.value.slice(0, PROFILE_BIO_MAX);
    saveSettings();
    saveProfile();
    renderSettings();
    renderProfile();
    renderRivals();
    el.profileStatus.textContent = 'プロフィールを保存しました。';
    announce('プロフィールを保存しました');
  });

  el.profileBioInput.addEventListener('input', function () {
    el.profileBioCount.textContent = String(el.profileBioInput.value.length);
  });

  el.profileImageFile.addEventListener('change', function () {
    var file = el.profileImageFile.files && el.profileImageFile.files[0];
    if (!file) return;
    /* 読み込み前の上限チェック（#28）: 巨大なファイルを読み込まない */
    if (file.size > FILE_LIMITS.imageBytes) {
      el.profileStatus.textContent = '画像ファイルが大きすぎます（10MBまで）。もう少し小さい画像を選んでください。';
      el.profileImageFile.value = '';
      return;
    }
    if (file.type && file.type.indexOf('image/') !== 0) {
      el.profileStatus.textContent = '画像ファイルを選んでください。';
      el.profileImageFile.value = '';
      return;
    }
    processProfileImage(file, function (dataUrl, errorMessage) {
      if (errorMessage) {
        el.profileStatus.textContent = errorMessage;
      } else {
        state.profile.image = dataUrl;
        saveProfile();
        renderProfile();
        el.profileStatus.textContent = 'プロフィール画像を設定しました。';
        announce('プロフィール画像を設定しました');
      }
      el.profileImageFile.value = '';
    });
  });

  el.profileImageDeleteBtn.addEventListener('click', function () {
    state.profile.image = '';
    saveProfile();
    renderProfile();
    el.profileStatus.textContent = 'プロフィール画像を削除しました。';
    announce('プロフィール画像を削除しました');
  });

  el.cardExportBtn.addEventListener('click', function () {
    var card = buildOwnCard();
    var blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'daily-training-card.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    el.cardStatus.textContent = '対戦カードを書き出しました。友達に送ってください。';
  });

  el.cardCopyBtn.addEventListener('click', function () {
    var text = JSON.stringify(buildOwnCard(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        el.cardStatus.textContent = '対戦カードをクリップボードにコピーしました。LINEなどで友達に送ってください。';
        announce('対戦カードをコピーしました');
      }, function () {
        el.cardStatus.textContent = 'コピーできませんでした。「対戦カードを書き出す」を使ってください。';
      });
    } else {
      el.cardStatus.textContent = 'この環境ではコピーできません。「対戦カードを書き出す」を使ってください。';
    }
  });

  el.rivalFile.addEventListener('change', function () {
    var file = el.rivalFile.files && el.rivalFile.files[0];
    if (!file) return;
    /* 読み込み前の上限チェック（#28） */
    if (file.size > FILE_LIMITS.jsonBytes) {
      el.rivalStatus.textContent = 'ファイルが大きすぎます（5MBまで）。対戦カードのJSONか確認してください。';
      el.rivalFile.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var card = null;
      try {
        card = sanitizeCard(JSON.parse(String(reader.result)));
      } catch (e) {
        card = null;
      }
      if (!card) {
        el.rivalStatus.textContent = '取り込めませんでした。対戦カードのJSONファイルか確認してください。';
      } else {
        /* 照合はカード固有ID（cardId）を優先し、無い旧形式カードは
           ニックネームで照合する（#18）。 */
        var existingIndex = -1;
        if (card.cardId !== '') {
          state.rivals.forEach(function (r, i) {
            if (r.cardId !== '' && r.cardId === card.cardId) existingIndex = i;
          });
        }
        if (existingIndex === -1) {
          state.rivals.forEach(function (r, i) {
            if (r.nickname === card.nickname) existingIndex = i;
          });
        }
        if (existingIndex >= 0) {
          state.rivals[existingIndex] = card;
          saveRivals();
          renderRivals();
          el.rivalStatus.textContent = card.nickname + 'さんのカードを更新しました。';
        } else if (state.rivals.length >= RIVAL_MAX) {
          el.rivalStatus.textContent = '友達は最大' + RIVAL_MAX + '人までです。先に誰かのカードを削除してください。';
        } else {
          state.rivals.push(card);
          saveRivals();
          renderRivals();
          el.rivalStatus.textContent = card.nickname + 'さんのカードを取り込みました。';
        }
        announce(el.rivalStatus.textContent);
      }
      el.rivalFile.value = '';
    };
    reader.readAsText(file);
  });

  el.shareBtn.addEventListener('click', function () {
    var key = dateKeyOf(todayDate());
    var stats = dayStats(key);
    var streak = calcStreak();
    var text = '毎日トレーニング: ' + streak + '日連続中。' +
      (stats.complete
        ? '今日は' + stats.totalDone + '/' + stats.totalTarget + 'セット完了しました。'
        : '今日は' + stats.totalDone + '/' + stats.totalTarget + 'セットまで進みました。');
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () { /* キャンセル時は何もしない */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        el.shareStatus.textContent = '結果をクリップボードにコピーしました。';
        announce('結果をクリップボードにコピーしました');
      }, function () {
        el.shareStatus.textContent = 'コピーできませんでした。文面: ' + text;
      });
    } else {
      el.shareStatus.textContent = 'この環境では共有できません。文面: ' + text;
    }
  });

  el.shortToggle.addEventListener('change', function () {
    var short = el.shortToggle.checked;
    ensureTodayRecord(short);
    saveRecords();
    renderToday();
    renderHistory();
    /* 短縮の影響を状態メッセージでも知らせる（#11） */
    announce(short
      ? '短縮モードをオンにしました。今日の目標は各種目' + state.settings.shortGoalSets + 'セットになります'
      : '短縮モードをオフにしました。今日の目標は通常に戻ります');
  });

  el.shortDays.addEventListener('change', function () {
    var selected = [];
    el.shortDays.querySelectorAll('input[name="short-day"]').forEach(function (box) {
      if (box.checked) selected.push(Number(box.value));
    });
    state.settings.shortWeekdays = selected;
    saveSettings();
    notifySaved();
    /* 今日の記録がまだ無い場合は初期値として反映される。
       記録がある場合は、その日の保存値（手動トグル）が優先される。 */
    renderToday();
  });

  el.trainingDays.addEventListener('change', function () {
    var selected = [];
    el.trainingDays.querySelectorAll('input[name="training-day"]').forEach(function (box) {
      if (box.checked) selected.push(Number(box.value));
    });
    if (selected.length === 0) {
      /* トレーニング日が0日になる操作は確認する（#12）。キャンセルでチェックを戻す。 */
      if (!window.confirm('トレーニング日が0日になります。よろしいですか？')) {
        renderSettings();
        return;
      }
    }
    state.settings.trainingWeekdays = selected;
    saveSettings();
    notifySaved();
    /* 日種別が変わるため、今日・履歴・アドバイスをまとめて描き直す */
    renderToday();
    renderHistory();
    announce('トレーニングする曜日を変更しました');
  });

  el.timeSlot.addEventListener('change', function () {
    state.settings.timeSlot = el.timeSlot.value;
    state.settings = sanitizeSettings(state.settings);
    saveSettings();
    notifySaved();
    renderToday();
  });

  el.timeValue.addEventListener('change', function () {
    state.settings.timeValue = el.timeValue.value;
    state.settings = sanitizeSettings(state.settings);
    el.timeValue.value = state.settings.timeValue;
    saveSettings();
    notifySaved();
    renderToday();
  });

  el.addForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = document.getElementById('add-name').value.trim();
    if (name === '') return;
    var ex = sanitizeExercise({
      name: name,
      amount: document.getElementById('add-amount').value,
      unit: document.getElementById('add-unit').value,
      sets: document.getElementById('add-sets').value,
      note: document.getElementById('add-note').value.trim()
    });
    if (!ex) return;
    state.exercises.push(ex);
    saveExercises();
    el.addForm.reset();
    document.getElementById('add-amount').value = '20';
    document.getElementById('add-sets').value = '2';
    renderAll();
    announce(ex.name + 'を追加しました');
  });

  el.exportBtn.addEventListener('click', function () {
    var payload = {
      app: 'daily-training',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: formatDateJa(todayDate()),
      exercises: state.exercises,
      records: state.records,
      settings: state.settings,
      profile: state.profile,
      rivals: state.rivals
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'daily-training-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    /* 最後に書き出した日を記録する（#26） */
    state.prefs.exportLastAt = formatDateJa(todayDate());
    savePrefs();
    if (el.lastExport) el.lastExport.textContent = '最後に書き出した日: ' + state.prefs.exportLastAt;
    el.dataStatus.textContent = 'エクスポートしました。';
  });

  el.importFile.addEventListener('change', function () {
    var file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    /* 読み込み前の上限チェック（#28） */
    if (file.size > FILE_LIMITS.jsonBytes) {
      el.dataStatus.textContent = 'インポートできませんでした: ファイルが大きすぎます（上限5MB）。';
      el.importFile.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = null;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        parsed = null;
      }
      if (parsed === null) {
        el.dataStatus.textContent = 'インポートできませんでした: JSONとして読めませんでした。ファイルを確認してください。';
        el.importFile.value = '';
        return;
      }
      /* 読み込む前に全体を検証する（#22）。不正なら現在のデータを維持する。 */
      var result = validateImportData(parsed);
      if (!result.ok) {
        el.dataStatus.textContent = 'インポートできませんでした: ' + result.error;
        el.importFile.value = '';
        return;
      }
      /* 現在のデータを自動で退避してから差し替える（#26） */
      stashBackup();
      state.exercises = result.data.exercises;
      state.records = result.data.records;
      state.settings = sanitizeSettings(Object.assign({}, result.data.settings, {
        cardId: result.data.settings.cardId !== '' ? result.data.settings.cardId : state.settings.cardId
      }));
      if (result.data.profile !== null) state.profile = result.data.profile;
      if (result.data.rivals !== null) state.rivals = result.data.rivals;
      saveAll();
      saveRivals();
      saveProfile();
      applyTheme();
      renderAll();
      if (el.restoreBackupBtn) el.restoreBackupBtn.hidden = false;
      el.dataStatus.textContent = 'インポートしました。読み込む前のデータは自動で退避しました（下のボタンから戻せます）。';
      el.importFile.value = '';
    };
    reader.readAsText(file);
  });

  if (el.restoreBackupBtn) {
    el.restoreBackupBtn.addEventListener('click', function () {
      var backup = loadJSON(STORAGE_KEYS.backup, null);
      if (!backup) {
        el.dataStatus.textContent = '退避したデータがありません。';
        return;
      }
      if (!window.confirm('インポート前に退避したデータに戻します。よろしいですか？')) return;
      var result = validateImportData(backup);
      if (!result.ok) {
        el.dataStatus.textContent = '退避データが壊れているため、戻せませんでした: ' + result.error;
        return;
      }
      state.exercises = result.data.exercises;
      state.records = result.data.records;
      state.settings = sanitizeSettings(Object.assign({}, result.data.settings, {
        cardId: result.data.settings.cardId !== '' ? result.data.settings.cardId : state.settings.cardId
      }));
      if (result.data.profile !== null) state.profile = result.data.profile;
      if (result.data.rivals !== null) state.rivals = result.data.rivals;
      saveAll();
      saveRivals();
      saveProfile();
      applyTheme();
      renderAll();
      el.dataStatus.textContent = '退避したデータに戻しました。';
    });
  }

  el.deleteAllBtn.addEventListener('click', function () {
    if (!window.confirm('すべてのデータ（種目・記録・設定・プロフィール・友達のカード）を削除して、はじめの状態に戻します。よろしいですか？')) {
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEYS.exercises);
      localStorage.removeItem(STORAGE_KEYS.records);
      localStorage.removeItem(STORAGE_KEYS.settings);
      localStorage.removeItem(STORAGE_KEYS.rivals);
      localStorage.removeItem(STORAGE_KEYS.profile);
      localStorage.removeItem(STORAGE_KEYS.prefs);
      localStorage.removeItem(STORAGE_KEYS.backup);
    } catch (e) { /* そのまま初期化する */ }
    editingExerciseId = null;
    editingHistoryKey = null;
    hideUndoBar();
    initState();
    initMypageSel();
    saveAll();
    savePrefs();
    applyTheme();
    renderAll();
    el.dataStatus.textContent = '全データを削除しました。';
  });
}

// ===== 初期化 =====
function initState() {
  var savedExercises = loadJSON(STORAGE_KEYS.exercises, null);
  if (Array.isArray(savedExercises)) {
    var list = [];
    savedExercises.forEach(function (raw) {
      var ex = sanitizeExercise(raw);
      if (ex) list.push(ex);
    });
    state.exercises = list;
  } else {
    state.exercises = clone(SEED_EXERCISES);
  }

  var savedRecords = loadJSON(STORAGE_KEYS.records, null);
  state.records = savedRecords && typeof savedRecords === 'object' ? savedRecords : {};

  state.settings = sanitizeSettings(loadJSON(STORAGE_KEYS.settings, null));

  var savedRivals = loadJSON(STORAGE_KEYS.rivals, null);
  state.rivals = [];
  if (Array.isArray(savedRivals)) {
    savedRivals.forEach(function (raw) {
      var card = sanitizeCard(raw);
      if (card && state.rivals.length < RIVAL_MAX) state.rivals.push(card);
    });
  }

  state.profile = sanitizeProfile(loadJSON(STORAGE_KEYS.profile, null));

  /* 画面の好み（案内の表示・期間選択・書き出し日）の読み込み（#1 #16 #26） */
  state.prefs = sanitizePrefs(loadJSON(STORAGE_KEYS.prefs, null));

  /* 対戦カードの固有ID（#18）。無ければ生成して保存する。 */
  if (state.settings.cardId === '') {
    state.settings.cardId = 'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  saveAll();
  saveRivals();
  saveProfile();
  savePrefs();
}

function init() {
  cacheElements();
  initState();
  initMypageSel();
  applyTheme();
  initEvents();
  renderAll();
  /* URLハッシュ（#menu / #mypage / #settings）で開かれた場合はそのビューを初期表示にする */
  var initial = window.location.hash.replace('#', '');
  if (VIEW_NAMES.indexOf(initial) !== -1 && initial !== 'today') showView(initial);
}

init();

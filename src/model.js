import { CHARACTER_CATALOG, DEFAULT_APPEARANCE, isAppearance } from './character.js';
export const STORAGE_KEY = 'lane-club:v1';
export const STROKES = ['자유형', '배영', '평영', '접영', '혼합'];
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validateRecord(input, today = localDate()) {
  const { date, stroke } = input;
  const distance = Number(input.distance), minutes = Number(input.minutes);
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(parsed.getTime()) || localDate(parsed) !== date || date > today || date < '2000-01-01') throw Error('2000년 이후, 오늘까지의 올바른 날짜를 선택해 주세요.');
  if (!STROKES.includes(stroke)) throw Error('영법을 선택해 주세요.');
  if (!Number.isInteger(distance) || distance < 25 || distance > 10000 || distance % 25 !== 0) throw Error('거리는 25~10,000m 사이에서 25m 단위로 입력해 주세요.');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw Error('수영 시간은 1~600분으로 입력해 주세요.');
  return { date, stroke, distance, minutes };
}
export const recordXP = record => record.distance / 25 * 10;
export function levelInfo(xp) {
  let level = 1, required = 100;
  while (xp >= required) { xp -= required; level++; required = level * 100; }
  return { level, current: xp, required, percent: xp / required * 100 };
}
export function summary(records, now = new Date()) {
  const today = localDate(now);
  const monday = new Date(`${today}T12:00:00`);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const days = new Set(records.map(r => r.date));
  const cursor = new Date(`${today}T12:00:00`);
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDate(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return {
    xp: records.filter(r => r.status === 'complete').reduce((s, r) => s + recordXP(r), 0),
    distance: records.reduce((s, r) => s + r.distance, 0),
    minutes: records.reduce((s, r) => s + r.minutes, 0),
    weekCount: records.filter(r => r.date >= localDate(monday) && r.date <= today).length,
    streak,
  };
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validRecords(records) {
  if (!Array.isArray(records)) return false;
  const ids = new Set();
  for (const record of records) {
    if (!isObject(record) || typeof record.id !== 'string' || !record.id.trim()
      || ids.has(record.id) || !['pending', 'complete'].includes(record.status)
      || typeof record.distance !== 'number' || typeof record.minutes !== 'number') return false;
    try { validateRecord(record, '9999-12-31'); } catch { return false; }
    ids.add(record.id);
  }
  return true;
}
// 원문은 결과에만 돌려준다. 판별·정규화는 저장하거나 입력을 바꾸지 않는다.
export function inspectSnapshot(raw) {
  if (raw === null) return {
    status: 'new', data: { version: 2, revision: 0, character: null, records: [] }, raw, sourceVersion: null,
  };
  const protectedResult = code => ({ status: 'protected', data: null, raw, sourceVersion: null, code });
  if (typeof raw !== 'string') return protectedResult('CORRUPT');
  let data;
  try { data = JSON.parse(raw); } catch { return protectedResult('CORRUPT'); }
  if (!isObject(data) || !Object.hasOwn(data, 'version')) return protectedResult('CORRUPT');
  if (data.version !== 1 && data.version !== 2) return protectedResult('UNSUPPORTED_VERSION');
  if (!validRecords(data.records)) return protectedResult('CORRUPT');
  if (data.version === 1) {
    if (typeof data.cap !== 'string' || !Object.hasOwn(CHARACTER_CATALOG.cap, data.cap)) return protectedResult('CORRUPT');
    return { status: 'ready', raw, sourceVersion: 1,
      data: { version: 2, revision: 0, character: { ...DEFAULT_APPEARANCE, cap: data.cap }, records: data.records } };
  }
  if (!Number.isSafeInteger(data.revision) || data.revision < 0
    || (data.character === null ? data.records.length !== 0 : !isAppearance(data.character))) return protectedResult('CORRUPT');
  return { status: data.character === null ? 'new' : 'ready', data, raw, sourceVersion: 2 };
}
// 기존 앱은 v1 쓰기를 유지한다. v2를 구형 writer로 덮지 않는다.
export function decode(raw) {
  const result = inspectSnapshot(raw);
  if (result.status === 'protected' || result.sourceVersion === 2) {
    const error = Error('저장 데이터 형식을 확인할 수 없습니다. 기존 데이터를 보호합니다.');
    error.code = result.code ?? 'UNSUPPORTED_VERSION';
    throw error;
  }
  return raw === null ? { version: 1, cap: 'orange', records: [] } : JSON.parse(raw);
}
export function createStore(storage) {
  let lastRaw = storage.getItem(STORAGE_KEY);
  let state = decode(lastRaw);
  return {
    get: () => structuredClone(state),
    save(next) {
      if (storage.getItem(STORAGE_KEY) !== lastRaw) throw Error('다른 탭에서 기록이 변경됐습니다. 새로고침 후 다시 시도해 주세요.');
      const raw = JSON.stringify(next);
      decode(raw);
      storage.setItem(STORAGE_KEY, raw); // Only update memory once persistence succeeds.
      lastRaw = raw; state = structuredClone(next);
    },
  };
}

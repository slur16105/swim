// 장비 ID와 색상·이름의 공통 정본. DOM과 저장소에 의존하지 않는다.
const option = (label, color) => Object.freeze({ label, color });
export const CHARACTER_CATALOG = Object.freeze({
  cap: Object.freeze({ orange: option('주황', '#f59046'), pink: option('분홍', '#e78dba'), green: option('초록', '#71ab63') }),
  goggles: Object.freeze({ dark: option('짙은 청록', '#254d51'), pink: option('분홍', '#e78dba'), green: option('초록', '#71ab63') }),
  suit: Object.freeze({ dark: option('짙은 초록', '#244b42'), orange: option('주황', '#f59046'), pink: option('분홍', '#e78dba') }),
});
export const DEFAULT_APPEARANCE = Object.freeze({ cap: 'orange', goggles: 'dark', suit: 'dark' });
export function isAppearance(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(CHARACTER_CATALOG).every(([part, options]) =>
      typeof value[part] === 'string' && Object.hasOwn(options, value[part]));
}

// Legacy cap strings fill only the two newly introduced equipment fields.
// Invalid IDs throw rather than silently changing the requested appearance.
export function normalizeAppearance(value = DEFAULT_APPEARANCE) {
  const appearance = typeof value === 'string' ? { ...DEFAULT_APPEARANCE, cap: value } : value;
  if (!isAppearance(appearance)) throw new TypeError('Invalid character appearance');
  return Object.freeze(Object.fromEntries(Object.keys(CHARACTER_CATALOG).map(part => [part, appearance[part]])));
}
export function appearanceSummary(value) {
  const appearance = normalizeAppearance(value);
  return Object.entries({ cap: '수모', goggles: '수경', suit: '수영복' })
    .map(([part, label]) => `${label} ${CHARACTER_CATALOG[part][appearance[part]].label}`).join(' · ');
}

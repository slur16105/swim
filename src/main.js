import './style.css';
import { localDate, validateRecord, summary, levelInfo, recordXP, STORAGE_KEY } from './model.js';
import { DEFAULT_APPEARANCE, appearanceSummary } from './character.js';
import { createCommandStore } from './storage.js';
import { drawAvatar } from './game/art.js';
import { createPool } from './game/PoolScene.js';
import { createCharacterEditor } from './ui/editor.js';
import { createSessionController } from './ui/session.js';
import { handleDialogTab } from './ui/dialog-focus.js';
const $ = selector => document.querySelector(selector);
const format = n => n.toLocaleString('ko-KR');
const storageCopy = '캐릭터와 수영 기록은 현재 브라우저에 저장돼요. 기기 간 동기화는 제공하지 않아요. 브라우저 데이터를 지우면 기록이 사라질 수 있고, 주소가 바뀌면 다른 저장 공간을 사용해요. 저장하지 않은 선택은 복구되지 않아요. 이미 열린 앱은 오프라인에서도 사용할 수 있지만 오프라인 첫 방문이나 재실행은 보장하지 않아요.';
document.querySelectorAll('.storage-copy').forEach(element => element.textContent = storageCopy);
const messages = {
  INVALID: '입력 내용을 확인해 주세요.', CORRUPT: '저장된 데이터가 손상되어 보호 중이에요. 기존 데이터를 덮어쓰지 않습니다.',
  UNSUPPORTED_VERSION: '이 앱에서 읽을 수 없는 저장 버전이에요. 기존 데이터를 보호하고 있어요.',
  STORAGE_UNAVAILABLE: '브라우저 저장 공간을 사용할 수 없어요. 선택과 입력을 유지했어요. 저장 설정을 확인해 주세요.',
  QUOTA: '브라우저 저장 공간이 부족해요. 선택과 입력을 유지했어요. 공간을 확보한 뒤 다시 저장해 주세요.',
  CONFLICT: '다른 탭에서 데이터가 변경되어 저장을 중단했어요. 선택과 기존 데이터를 보호하고 있어요.',
  BUSY: '저장 공간이 사용 중이에요. 선택과 입력을 유지했어요. 잠시 뒤 다시 저장해 주세요.',
  UNSUPPORTED: '이 환경에서는 안전한 저장 기능을 지원하지 않아요. 읽기만 가능해요. 저장소·Web Locks·dialog를 지원하는 브라우저를 사용해 주세요.',
  NOT_FOUND: '완료할 기록을 찾을 수 없어요.', CANCELLED: '이 작업은 취소됐어요.',
};
const errorMessage = code => messages[code] ?? '저장하지 못했어요. 입력을 유지했으니 다시 시도해 주세요.';
// Reacquire access on every operation so an explicit reload can recover after permission changes.
const storage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const store = createCommandStore(storage);
const supported = typeof navigator.locks?.request === 'function' && typeof HTMLDialogElement !== 'undefined' && typeof $('#record-dialog').showModal === 'function';
let recovering = false, recoveryPanel = null, recoveryFocus = null;
let ready = false, pool, timer, submitting = false, editor, recordReturnFocus, previousRecord;
let state = store.get().data, renderedSnapshot;
const canWrite = () => !recovering && supported && store.get().status !== 'protected' && store.get().code !== 'UNSUPPORTED';
const canRecord = () => canWrite() && !!state?.character && ready && !session.busy && !submitting;
function toast(message) { clearTimeout(timer); $('#toast').textContent = message; $('#toast').hidden = false; timer = setTimeout(() => $('#toast').hidden = true, 5000); }
function displayAppearance() {
  if (!state?.character) {
    $('#avatar').hidden = true; $('#appearance-summary').textContent = ''; $('#display-error').hidden = true;
    try { pool?.scene.setAppearance(DEFAULT_APPEARANCE); } catch { $('#display-error').hidden = false; }
    return;
  }
  $('#appearance-summary').textContent = appearanceSummary(state.character);
  $('#avatar').setAttribute('aria-label', appearanceSummary(state.character));
  let failed = false;
  try { drawAvatar($('#avatar'), state.character); $('#avatar').hidden = false; } catch { $('#avatar').hidden = true; failed = true; }
  try { pool?.scene.setAppearance(state.character); } catch { failed = true; }
  $('#display-error').hidden = !failed;
}
const session = createSessionController({ store, play: (record, context) => pool.scene.play(record, context), onChange: () => render(),
  completionBaseline: () => levelInfo(summary(store.get().data.records).xp).level,
  onProgress(distance, total, active) {
    $('#swim-progress').value = distance / total * 100;
    $('#session-distance').textContent = `${format(Math.floor(distance))} / ${format(total)} m`;
    $('#session-detail').textContent = `${Math.floor(distance / 25)} / ${total / 25}구간 · ${active.replay ? '다시 보기는 XP가 추가되지 않아요.' : '완료 저장 후 XP를 받아요.'}`;
  },
  onComplete(result, active) {
    if (result.code === 'CANCELLED') return;
    if (!canWrite() && result.ok) result = { ok: false, code: store.get().code ?? 'CONFLICT' };
    const before = active.levelBefore;
    state = store.get().data;
    $('#session-badge').textContent = result.ok ? 'COMPLETE' : 'PENDING';
    $('#session-title').textContent = result.ok ? '오늘도 잘 헤엄쳤어요!' : 'XP 지급 대기';
    const after = levelInfo(summary(state.records).xp).level;
    const message = active.replay ? '다시 보기 완료 · XP 추가 없음' : `${active.record.distance / 25}구간 완료 · +${format(recordXP(active.record))} XP${after > before ? ` · 레벨 ${after} 달성!` : ''}`;
    $('#session-detail').textContent = result.ok ? message : `${errorMessage(result.code)} 기록의 ‘이어서 수영’으로 처음부터 다시 시도할 수 있어요.`;
    editor?.announceCompletion(result.ok ? message : `수영은 끝났지만 완료 저장에 실패했어요. XP 지급 대기 · ${errorMessage(result.code)}`);
    render(); if (result.ok) { $('#character-feedback').textContent = message; toast(message); }
  },
});
function render() {
  const snapshot = store.get(); state = snapshot.data;
  const records = state?.records ?? [], stats = summary(records), level = levelInfo(stats.xp);
  const code = !supported ? 'UNSUPPORTED' : snapshot.code;
  $('#storage-alert').hidden = !code;
  $('#storage-alert').textContent = code ? errorMessage(code) : '';
  for (const [id, value, unit] of [['total-distance', stats.distance, 'm'], ['total-minutes', stats.minutes, '분'], ['week-count', stats.weekCount, '회'], ['streak', stats.streak, '일']]) $(`#${id}`).textContent = `${format(value)} ${unit}`;
  const hasCharacter = !!state?.character;
  $('#character-title').textContent = snapshot.status === 'protected' && !state ? '저장 데이터를 보호하고 있어요' : hasCharacter ? '꾸준한 스위머' : '내 캐릭터를 만들어 보세요';
  $('#character-message').textContent = hasCharacter ? '한 번의 수영이, 한 뼘의 성장으로.' : snapshot.status === 'protected' ? '저장 내용을 확인할 수 없어 생성을 시작하지 않습니다.' : '수모·수경·수영복 색상을 고르고 첫 수영을 기록해요.';
  $('#character-growth').hidden = !hasCharacter;
  $('#edit-character').hidden = !hasCharacter; $('#edit-character').disabled = !canWrite();
  $('#level-chip').textContent = `LV. ${level.level}`; $('#xp-label').textContent = `${format(level.current)} / ${format(level.required)} XP`; $('#xp-progress').value = level.percent;
  $('#record-count').textContent = records.length; $('#empty-state').hidden = records.length > 0; $('#history-wrapper').hidden = records.length === 0;
  $('#main-action').textContent = hasCharacter ? '＋ 수영 기록하기' : '내 캐릭터 만들기';
  $('#main-action').disabled = hasCharacter ? !canRecord() : !canWrite();
  document.querySelectorAll('[data-open-record]').forEach(button => button.disabled = !canRecord());
  $('#record-lock-reason').textContent = !canWrite() ? '데이터 보호를 위해 읽기만 가능해요.' : !hasCharacter ? '캐릭터를 저장하면 수영을 기록할 수 있어요.' : !ready ? '수영장을 준비하고 있어요.' : session.completing ? '완료 내용을 저장하고 있어요. 잠시 기다려 주세요.' : session.busy ? '수영 연출 중에는 새 기록과 수정을 할 수 없어요.' : submitting ? '기록을 저장하고 있어요.' : '';
  $('#pause').disabled = !session.busy || session.completing;
  $('#speed').disabled = session.completing || !ready;
  const tbody = $('#record-list'); tbody.replaceChildren();
  [...records].sort((a,b) => b.date.localeCompare(a.date)).forEach(record => {
    const row = document.createElement('tr');
    for (const text of [record.date.replaceAll('-', '.'), record.stroke, `${format(record.distance)} m`, `${record.minutes} 분`, record.status === 'complete' ? `+${format(recordXP(record))} XP` : 'XP 지급 대기']) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
    const actions = document.createElement('td'), wrap = document.createElement('div'); wrap.className = 'record-actions';
    for (const [text, action] of [[record.status === 'pending' ? '이어서 수영' : '다시 보기', () => start(record)], ['수정', () => openForm(record)]]) { const button = document.createElement('button'); button.textContent = text; button.disabled = !canRecord(); button.addEventListener('click', action); wrap.append(button); }
    actions.append(wrap); row.append(actions); tbody.append(row);
  });
  editor?.refresh();
  $('#record-blocked').textContent = !canWrite() ? errorMessage(code) : !hasCharacter ? '기록하려면 먼저 캐릭터를 만들어 주세요. 위 닫기 버튼으로 돌아간 뒤 ‘내 캐릭터 만들기’를 선택해 주세요.' : '';
  $('#record-form').querySelectorAll('input,select,[data-distance]').forEach(element => element.disabled = submitting || recovering || session.busy);
  $('#close-dialog').disabled = submitting || recovering;
  $('.submit-button').disabled = !canRecord();
  renderRecovery();
  renderedSnapshot = JSON.stringify(snapshot);
}
function start(record) {
  if (!canRecord()) return;
  try {
    if (!session.start(record)) return;
    $('#session-badge').textContent = record.status === 'complete' ? 'REPLAY' : 'SWIMMING';
    $('#session-title').textContent = `${record.stroke} ${format(record.distance)}m ${record.status === 'complete' ? '다시 보기' : '수영 중'}`;
    $('#session-distance').textContent = `0 / ${format(record.distance)} m`; $('#swim-progress').value = 0;
    $('#session-detail').textContent = `0 / ${record.distance / 25}구간 · ${record.status === 'complete' ? '다시 보기는 XP가 추가되지 않아요.' : '완료 저장 후 XP를 받아요.'}`;
    $('#pause').textContent = '일시정지';
  } catch { $('#session-title').textContent = '수영 표시를 시작하지 못했어요'; $('#session-detail').textContent = '기록은 저장되어 있어요. 표시를 다시 시도한 뒤 이어서 수영해 주세요.'; $('#display-error').hidden = false; }
}
editor = createCharacterEditor({ canSave: canWrite, errorMessage, interceptClose: () => { if (!recoveryPanel) return false; cancelRecovery(); return true; },
  blockingReason: () => canWrite() ? '' : errorMessage(!supported ? 'UNSUPPORTED' : store.get().code),
  save: appearance => store.saveCharacter(appearance),
  onFailed: () => render(),
  onSaved({ editing }) { render(); displayAppearance(); $('#character-feedback').textContent = editing ? '캐릭터 외형을 저장했어요.' : '캐릭터를 저장했어요. 이제 첫 수영을 기록해 보세요.'; if (!editing) ($('#main-action').disabled ? $('#character-title') : $('#main-action')).focus(); },
});
$('#main-action').addEventListener('click', () => state?.character ? openForm() : editor.open());
$('#edit-character').addEventListener('click', () => editor.open(state?.character));
$('#retry-display').addEventListener('click', displayAppearance);
const dialog = $('#record-dialog'), form = $('#record-form');
function openForm(record) {
  if (!canRecord()) return;
  recordReturnFocus = document.activeElement; previousRecord = record;
  form.reset(); form.elements.id.value = record?.id ?? crypto.randomUUID();
  form.elements.date.max = localDate(); form.elements.date.value = record?.date ?? localDate();
  form.elements.stroke.value = record?.stroke ?? '자유형'; form.elements.distance.value = record?.distance ?? ''; form.elements.minutes.value = record?.minutes ?? '';
  $('#dialog-title').textContent = record ? '수영 기록 수정하기' : '오늘은 얼마나 헤엄쳤나요?';
  $('.submit-button').textContent = record ? '수정한 기록 저장하기' : '기록 저장하고 수영하기';
  $('#form-error').textContent = ''; updatePreview(); dialog.showModal(); $('#dialog-title').focus();
}
function closeForm() { if (recoveryPanel) { cancelRecovery(); return; } if (submitting || recovering) return; dialog.close(); (recordReturnFocus?.isConnected && !recordReturnFocus.disabled ? recordReturnFocus : $('#character-title')).focus(); }
function updatePreview() {
  const distance = Number(form.elements.distance.value);
  $('#record-preview').textContent = distance >= 25 && distance <= 10000 && distance % 25 === 0 ? `${format(distance / 25)}구간 · 약 ${Math.ceil(distance / 25 * 0.8)}초 연출 (1× 기준) · ${format(distance / 25 * 10)} XP` : '25m 단위로 기록할 수 있어요.';
  $('#xp-reduction').hidden = !(previousRecord?.status === 'complete' && distance < previousRecord.distance);
}
document.querySelectorAll('[data-open-record]').forEach(button => button.addEventListener('click', () => openForm()));
$('#close-dialog').addEventListener('click', closeForm);
dialog.addEventListener('keydown', event => {
  handleDialogTab(event, dialog, recoveryPanel === 'record' ? $('#record-recovery-status') : $('#dialog-title'));
  if (event.key === 'Escape') { event.preventDefault(); closeForm(); }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closeForm(); });
form.addEventListener('input', updatePreview);
document.querySelectorAll('[data-distance]').forEach(button => button.addEventListener('click', () => { form.elements.distance.value = button.dataset.distance; updatePreview(); }));
form.addEventListener('submit', async event => {
  event.preventDefault(); if (submitting || !canRecord()) return;
  let input;
  try { input = { ...validateRecord(Object.fromEntries(new FormData(form))), id: form.elements.id.value }; }
  catch (error) { $('#form-error').textContent = error.message; $('#form-error').focus(); return; }
  submitting = true; $('#form-error').textContent = ''; form.setAttribute('aria-busy', 'true');
  form.querySelectorAll('input,select,button').forEach(element => element.disabled = true); render();
  const submittedEpoch = session.epoch;
  const result = await store.saveRecord(input, { epoch: submittedEpoch });
  if (submittedEpoch !== session.epoch || result.code === 'CANCELLED') return;
  submitting = false; form.setAttribute('aria-busy', 'false'); form.querySelectorAll('input,select,button').forEach(element => element.disabled = false); render();
  if (!result.ok) { $('#form-error').textContent = errorMessage(result.code); $('#form-error').focus(); return; }
  closeForm();
  const record = state.records.find(item => item.id === input.id);
  if (record.status === 'complete') { toast('기록을 수정하고 경험치를 다시 계산했어요.'); $('#character-feedback').textContent = '기록을 수정하고 경험치를 다시 계산했어요.'; }
  else { toast('수영 기록을 저장했어요.'); start(record); }
});
$('#pause').addEventListener('click', () => {
  if (!session.busy || session.completing) return;
  pool.scene.paused = !pool.scene.paused; $('#pause').textContent = pool.scene.paused ? '계속 수영' : '일시정지';
  $('#session-badge').textContent = pool.scene.paused ? 'PAUSED' : session.current.replay ? 'REPLAY' : 'SWIMMING';
});
$('#speed').addEventListener('click', () => { if (!ready || session.completing) return; pool.scene.speed = pool.scene.speed === 4 ? 1 : pool.scene.speed * 2; $('#speed').textContent = `${pool.scene.speed}×`; });
// Recovery stays in the active panel and never navigates or writes a snapshot.
const recoveryPrefixes = ['home', 'editor', 'record'];
function renderRecovery() {
  const show = recovering || store.get().status === 'protected';
  for (const prefix of ['home', 'editor', 'record']) {
    $(`#${prefix}-recovery`).hidden = !show;
    $(`#${prefix}-recovery-actions`).hidden = recoveryPanel === prefix;
    $(`#${prefix}-recovery-confirm`).hidden = recoveryPanel !== prefix;
    $(`#${prefix}-recovery-status`).textContent = recovering ? '최신 저장 내용을 불러오고 있어요. 잠시 기다려 주세요.' : '';
    for (const action of ['keep', 'reload', 'recovery-cancel', 'recovery-accept']) $(`#${prefix}-${action}`).disabled = recovering;
  }
}
function cancelRecovery() {
  if (recovering) return;
  recoveryPanel = null;
  $('#editor-body').inert = false; $('#discard-confirmation').inert = false; $('#record-form').inert = false;
  renderRecovery();
  if (recoveryFocus?.isConnected && !recoveryFocus.disabled) recoveryFocus.focus();
}
function schedulePending() {
  const epoch = session.epoch;
  setTimeout(() => {
    if (epoch !== session.epoch || recovering) return;
    displayAppearance();
    const pending = state?.records.find(record => record.status === 'pending');
    if (pending && canRecord()) { toast('미완료 수영을 처음부터 다시 재생해요. 기록은 유지돼요.'); start(pending); }
  }, 0);
}
async function recover() {
  if (recovering || !recoveryPanel) return;
  const prefix = recoveryPanel;
  $(`#${prefix}-recovery-error`).textContent = '';
  recovering = true;
  // This is the only epoch transition: invalidate synchronously before stopping Phaser.
  const epoch = session.invalidate();
  try { pool?.scene.stop(); } catch { $('#display-error').hidden = false; }
  $('#session-badge').textContent = 'STOPPED'; $('#session-title').textContent = '수영을 중지했어요';
  $('#session-detail').textContent = '최신 저장 내용을 확인하고 있어요. 완료나 XP는 저장하지 않아요.';
  $('#pause').textContent = '일시정지';
  editor.beginRecovery(); submitting = false;
  form.setAttribute('aria-busy', 'false');
  form.querySelectorAll('input,select,button').forEach(element => element.disabled = false);
  render(); $(`#${prefix}-recovery-status`).focus();
  const result = await store.reload({ epoch });
  if (epoch !== session.epoch || result.code === 'CANCELLED') return;
  recovering = false;
  recoveryPanel = null;
  $('#editor-body').inert = false; $('#discard-confirmation').inert = false; $('#record-form').inert = false;
  state = store.get().data;
  editor.finishRecovery(result, state?.character);
  if (result.ok) {
    for (const name of recoveryPrefixes) $(`#${name}-recovery-error`).textContent = '';
    clearTimeout(timer); $('#toast').hidden = true; $('#character-feedback').textContent = '';
    $('#form-error').textContent = '';
    $('#session-badge').textContent = 'READY'; $('#session-title').textContent = '오늘도, 한 레인부터.';
    $('#session-distance').textContent = '0 / 0 m'; $('#swim-progress').value = 0;
    $('#session-detail').textContent = '최신 저장 내용을 불러왔어요.';
    $('#pause').textContent = '일시정지';
    if (dialog.open) {
      const latest = state?.records.find(record => record.id === form.elements.id.value);
      previousRecord = latest; form.reset();
      form.elements.id.value = latest?.id ?? crypto.randomUUID();
      form.elements.date.max = localDate(); form.elements.date.value = latest?.date ?? localDate();
      form.elements.stroke.value = latest?.stroke ?? '자유형'; form.elements.distance.value = latest?.distance ?? ''; form.elements.minutes.value = latest?.minutes ?? '';
      $('#dialog-title').textContent = latest ? '수영 기록 수정하기' : '오늘은 얼마나 헤엄쳤나요?';
      $('.submit-button').textContent = latest ? '수정한 기록 저장하기' : '기록 저장하고 수영하기'; updatePreview();
    }
    render(); displayAppearance();
    (prefix === 'editor' ? $('#editor-title') : prefix === 'record' ? $('#dialog-title') : $('#character-title')).focus();
    if (ready) schedulePending();
  } else {
    $('#session-detail').textContent = '복구하지 못해 수영을 중지한 상태예요. 선택을 유지했으니 최신 내용 불러오기로 다시 시도해 주세요.';
    render();
    // A reload timeout/unsupported lock also leaves recovery explicitly available.
    $(`#${prefix}-recovery`).hidden = false;
    $(`#${prefix}-recovery-error`).textContent = `${errorMessage(result.code)} 선택을 유지했어요. 최신 내용 불러오기로 다시 시도할 수 있어요.`;
    $(`#${prefix}-recovery-error`).focus();
  }
}
for (const prefix of recoveryPrefixes) {
  $(`#${prefix}-keep`).addEventListener('click', () => {
    (prefix === 'editor' ? $('#editor-title') : prefix === 'record' ? $('#dialog-title') : $('#character-title')).focus();
  });
  $(`#${prefix}-reload`).addEventListener('click', () => {
    if (recovering) return;
    recoveryFocus = document.activeElement; recoveryPanel = prefix;
    $('#editor-body').inert = prefix === 'editor'; $('#discard-confirmation').inert = prefix === 'editor'; $('#record-form').inert = prefix === 'record';
    renderRecovery(); $(`#${prefix}-recovery-cancel`).focus();
  });
  $(`#${prefix}-recovery-cancel`).addEventListener('click', cancelRecovery);
  $(`#${prefix}-recovery-accept`).addEventListener('click', recover);
}

$('#home-recovery').addEventListener('keydown', event => {
  if (event.key === 'Escape' && recoveryPanel === 'home') { event.preventDefault(); cancelRecovery(); }
});

function externalCheck() {
  const snapshot = store.checkExternalChange();
  if (JSON.stringify(snapshot) === renderedSnapshot) return;
  const focused = document.activeElement;
  const focusedRow = $('#record-list').contains(focused);
  render();
  if (focusedRow && (!focused.isConnected || focused.disabled)) $('#character-title').focus();
}
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) externalCheck(); }); window.addEventListener('focus', externalCheck);
render(); displayAppearance();
try {
  pool = createPool({ appearance: state?.character ?? DEFAULT_APPEARANCE,
    onReady() { ready = true; $('#game-loading').hidden = true; render(); schedulePending(); },
    onProgress: (distance, total, context) => session.progress(distance, total, context), onComplete: (id, context) => session.complete(id, context),
  });
} catch { $('#game-loading').textContent = '수영장을 시작하지 못했습니다. 브라우저를 새로고침해 주세요.'; }

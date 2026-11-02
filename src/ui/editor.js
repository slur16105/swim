import { CHARACTER_CATALOG, DEFAULT_APPEARANCE, appearanceSummary } from '../character.js';
import { drawAvatar } from '../game/art.js';
import { handleDialogTab } from './dialog-focus.js';

export function createCharacterEditor({ save, canSave, onSaved, onFailed = () => {}, errorMessage, blockingReason = () => '', interceptClose = () => false }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#character-dialog'), form = $('#character-form');
  let generation = 0, recovering = false;
  let draft, baseline, editing = false, saving = false, confirming = false, returnFocus, previousFocus, lastSelection;
  const dirty = () => !!draft && ['cap', 'goggles', 'suit'].some(part => draft[part] !== baseline[part]);
  const validFocus = element => element?.isConnected && !element.disabled && !element.hidden && !element.closest?.('[hidden], [inert]');
  const leaveWarning = event => { event.preventDefault(); event.returnValue = ''; };
  let warningAttached = false;
  function updateWarning() {
    const needed = !!dialog.open && dirty();
    if (needed === warningAttached) return;
    warningAttached = needed;
    globalThis.window?.[needed ? 'addEventListener' : 'removeEventListener']?.('beforeunload', leaveWarning);
  }
  function preview() {
    $('#preview-summary').textContent = appearanceSummary(draft);
    $('#preview-avatar').setAttribute('aria-label', appearanceSummary(draft));
    try { drawAvatar($('#preview-avatar'), draft); $('#preview-avatar').hidden = false; $('#preview-error').hidden = true; }
    catch { $('#preview-avatar').hidden = true; $('#preview-error').hidden = false; }
    for (const radio of form.querySelectorAll('input[type=radio]')) radio.checked = draft[radio.name] === radio.value;
    for (const [part, options] of Object.entries(CHARACTER_CATALOG)) $(`#current-${part}`).textContent = options[draft[part]].label;
  }
  function lock() {
    dialog.querySelectorAll('button,input').forEach(element => element.disabled = saving || recovering);
    $('#save-character').disabled = saving || recovering || !canSave() || (editing && !dirty());
    $('#editor-unchanged').textContent = editing && !dirty() ? '변경한 내용이 없어요. 색상을 바꾸면 저장할 수 있어요.' : '';
    updateWarning();
    $('#editor-status').textContent = saving ? '저장 중이에요. 잠시 기다려 주세요.' : '';
    form.setAttribute('aria-busy', String(saving));
    $('#editor-blocked').textContent = blockingReason();
  }
  function close(success = false) {
    dialog.close(); updateWarning();
    if (!success || editing) (validFocus(returnFocus) ? returnFocus : $('#character-title')).focus();
  }
  function resume() {
    confirming = false; $('#discard-confirmation').hidden = true; $('#editor-body').hidden = false;
    const target = validFocus(previousFocus) ? previousFocus : validFocus(lastSelection) ? lastSelection : $('#editor-title');
    target.focus();
  }
  function requestClose() {
    if (interceptClose()) return;
    if (saving || recovering) return;
    if (confirming) { resume(); return; }
    if (!dirty()) { close(); return; }
    previousFocus = document.activeElement;
    confirming = true; $('#editor-body').hidden = true; $('#discard-confirmation').hidden = false;
    $('#continue-editing').focus();
  }
  for (const [part, options] of Object.entries(CHARACTER_CATALOG)) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'color-group';
    const label = { cap: '수모', goggles: '수경', suit: '수영복' }[part];
    const legend = document.createElement('legend'); legend.append(`${label} · `);
    const current = document.createElement('span'); current.id = `current-${part}`; legend.append(current); fieldset.append(legend);
    const group = document.createElement('div'); group.className = 'color-options';
    for (const [id, option] of Object.entries(options)) {
      const wrapper = document.createElement('label'); wrapper.className = 'color-option';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = part; radio.value = id; radio.setAttribute('aria-label', `${label} ${option.label}`);
      radio.addEventListener('change', () => { if (!saving) { draft[part] = id; lastSelection = radio; preview(); lock(); } });
      const chip = document.createElement('span'); chip.className = 'chip'; chip.style.backgroundColor = option.color; chip.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.textContent = option.label;
      const mark = document.createElement('span'); mark.className = 'selected-mark'; mark.textContent = ' ✓ 선택됨'; mark.setAttribute('aria-hidden', 'true'); text.append(mark);
      wrapper.append(radio, chip, text); group.append(wrapper);
    }
    fieldset.append(group); $('#color-groups').append(fieldset);
  }
  $('#close-editor').addEventListener('click', requestClose);
  $('#cancel-editor').addEventListener('click', requestClose);
  dialog.addEventListener('keydown', event => {
    handleDialogTab(event, dialog, $('#editor-title'));
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  $('#continue-editing').addEventListener('click', resume);
  $('#discard-editor').addEventListener('click', () => close());
  $('#retry-preview').addEventListener('click', preview);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || confirming || !canSave() || (editing && !dirty())) return;
    saving = true; $('#editor-error').textContent = ''; lock();
    const submittedGeneration = generation;
    const result = await save({ ...draft });
    if (submittedGeneration !== generation || result.code === 'CANCELLED') return;
    saving = false; lock();
    if (result.ok) { close(true); onSaved({ editing }); }
    else { onFailed(result); $('#editor-error').textContent = errorMessage(result.code); $('#editor-error').focus(); }
  });
  return {
    open(appearance = null) {
      if (!canSave() || dialog.open) return;
      editing = !!appearance; baseline = { ...(appearance ?? DEFAULT_APPEARANCE) }; draft = { ...baseline };
      returnFocus = document.activeElement; previousFocus = null; lastSelection = null; confirming = false;
      $('#editor-title').textContent = editing ? '캐릭터 꾸미기' : '내 캐릭터 만들기';
      $('#close-editor').setAttribute('aria-label', editing ? '캐릭터 꾸미기 닫기' : '캐릭터 만들기 닫기');
      $('#editor-completion').textContent = '';
      $('#editor-body').hidden = false; $('#discard-confirmation').hidden = true;
      $('#editor-error').textContent = ''; $('#editor-storage-notice').open = true;
      preview(); lock(); dialog.showModal(); $('#editor-title').focus();
    },
    beginRecovery() { generation++; recovering = true; saving = false; $('#editor-completion').textContent = ''; lock(); },
    finishRecovery(result, appearance) {
      recovering = false;
      if (result.ok && dialog.open) {
        editing = !!appearance; baseline = { ...(appearance ?? DEFAULT_APPEARANCE) }; draft = { ...baseline };
        confirming = false; previousFocus = null; lastSelection = null;
        $('#editor-body').hidden = false; $('#discard-confirmation').hidden = true;
        $('#editor-title').textContent = editing ? '캐릭터 꾸미기' : '내 캐릭터 만들기';
        $('#close-editor').setAttribute('aria-label', editing ? '캐릭터 꾸미기 닫기' : '캐릭터 만들기 닫기');
        $('#editor-error').textContent = ''; $('#editor-completion').textContent = ''; preview();
      }
      lock();
    },
    refresh: lock,
    announceCompletion(message) { if (dialog.open) $('#editor-completion').textContent = message; },
  };
}

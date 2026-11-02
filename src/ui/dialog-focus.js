// Native dialog containment may still hand Tab to browser chrome. Wrap the
// visible tab stops explicitly; negative-tabindex headings are focus fallbacks.
export function handleDialogTab(event, dialog, fallback) {
  if (event.key !== 'Tab') return;
  const candidates = [...dialog.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.disabled && !element.matches(':disabled')
      && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
  const focusable = candidates.filter(element => {
    if (element.type !== 'radio' || !element.name) return true;
    const group = candidates.filter(other => other.type === 'radio' && other.name === element.name && other.form === element.form);
    return element === (group.find(radio => radio.checked) ?? group[0]);
  });
  const current = dialog.ownerDocument.activeElement;
  if (!focusable.length) {
    event.preventDefault(); fallback.focus(); return;
  }
  if (!focusable.includes(current) || (!event.shiftKey && current === focusable.at(-1)) || (event.shiftKey && current === focusable[0])) {
    event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus();
  }
}

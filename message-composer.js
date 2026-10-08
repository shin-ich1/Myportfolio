/* Shared private-message composer keyboard contract.
   One owner for Public and Admin message textareas:
   - Enter sends.
   - Shift+Enter inserts a new line.
   - IME composition and modified key chords never submit accidentally. */
export function bindMessageComposerKeyboard(form, textarea) {
  if (!(form instanceof HTMLFormElement) || !(textarea instanceof HTMLTextAreaElement)) return () => {};

  const onKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (textarea.disabled || textarea.readOnly || !String(textarea.value || "").trim()) return;

    const submitter = form.querySelector('button[type="submit"],input[type="submit"]');
    if (submitter?.disabled) return;
    event.preventDefault();
    if (typeof form.requestSubmit === "function") {
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
    } else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  textarea.addEventListener("keydown", onKeyDown);
  return () => textarea.removeEventListener("keydown", onKeyDown);
}

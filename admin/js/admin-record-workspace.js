function requiredElement(root, selector, label) {
  const element = root?.querySelector?.(selector);
  if (!element) throw new Error(`Admin record workspace is missing ${label}.`);
  return element;
}

export function createAdminRecordWorkspaceController(root) {
  if (!root) throw new Error("Admin record workspace root is required.");

  const idle = requiredElement(root, "[data-lan-record-workspace-idle]", "idle state");
  const editor = requiredElement(root, "[data-lan-record-workspace-editor]", "editor state");
  const preview = requiredElement(root, "[data-lan-record-workspace-preview]", "preview pane");
  const addButton = root.querySelector("[data-lan-record-add]");
  const closePreviewButton = root.querySelector("[data-lan-record-preview-close]");

  let editorMode = "idle";
  let previewOpen = false;

  function apply() {
    root.dataset.editorMode = editorMode;
    root.dataset.previewOpen = previewOpen ? "true" : "false";
    const workspaceCovered = previewOpen;
    idle.hidden = workspaceCovered || editorMode !== "idle";
    editor.hidden = workspaceCovered || editorMode === "idle";
    preview.hidden = !previewOpen;
    addButton?.setAttribute("aria-pressed", editorMode === "create" ? "true" : "false");
    closePreviewButton?.setAttribute("aria-expanded", previewOpen ? "true" : "false");
  }

  function showIdle({ keepPreview = false } = {}) {
    editorMode = "idle";
    if (!keepPreview) previewOpen = false;
    apply();
  }

  function startCreate() {
    editorMode = "create";
    previewOpen = false;
    apply();
  }

  function startEdit() {
    editorMode = "edit";
    previewOpen = false;
    apply();
  }

  function openPreview() {
    previewOpen = true;
    apply();
  }

  function closePreview() {
    previewOpen = false;
    apply();
  }

  function getState() {
    return Object.freeze({ editorMode, previewOpen });
  }

  const handleAdd = () => root.dispatchEvent(new CustomEvent("lan:recordcreate", { bubbles: false }));
  const handlePreviewClose = () => root.dispatchEvent(new CustomEvent("lan:recordpreviewclose", { bubbles: false }));
  addButton?.addEventListener("click", handleAdd);
  closePreviewButton?.addEventListener("click", handlePreviewClose);

  function destroy() {
    addButton?.removeEventListener("click", handleAdd);
    closePreviewButton?.removeEventListener("click", handlePreviewClose);
  }

  apply();
  return { showIdle, startCreate, startEdit, openPreview, closePreview, getState, destroy };
}

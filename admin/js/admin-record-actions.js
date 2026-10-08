/* Canonical saved-record command presentation owner.
   One command markup is decorated once, then CSS selects text or icon presentation
   from the measured Admin mode without duplicating desktop/mobile controls. */
const recordActionIcons = Object.freeze({
  preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-5.2 9.2-5.2S21.2 12 21.2 12 17.8 17.2 12 17.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.8-.8 4 4-.8L18.7 8.5 15.5 5.3 4 16.8Z"/><path d="m13.9 6.9 3.2 3.2"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.8h6V7M7 7l.8 12h8.4L17 7M10 10.3v5.4M14 10.3v5.4"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M7.5 10.5 12 15l4.5-4.5M4 19h16"/></svg>',
  credential: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>'
});

export function recordActionKind(command) {
  if (!(command instanceof HTMLElement)) return "";
  const names = [...command.attributes].map((attribute) => attribute.name.toLowerCase());
  if (names.some((name) => name.includes("preview"))) return "preview";
  if (names.some((name) => name.includes("duplicate") || name.includes("copy"))) return "duplicate";
  if (names.some((name) => name.includes("download"))) return "download";
  if (names.some((name) => name.includes("delete") || name.includes("remove"))) return "delete";
  if (names.some((name) => name.includes("edit"))) return "edit";
  const label = String(command.textContent || "").trim().toLowerCase();
  if (/^(preview|view)$/.test(label)) return "preview";
  if (/^(edit|rename)$/.test(label)) return "edit";
  if (/^(delete|remove)$/.test(label)) return "delete";
  if (/^(duplicate|copy)$/.test(label)) return "duplicate";
  if (/^download/.test(label)) return "download";
  if (/^(credential|open credential)$/.test(label)) return "credential";
  return "";
}

export function decorateRecordCommand(command) {
  if (!(command instanceof HTMLElement) || command.dataset.lanRecordActionDecorated === "true") return command;
  const kind = recordActionKind(command);
  if (!kind || !recordActionIcons[kind]) return command;
  const label = String(command.textContent || "").trim();
  if (!label) return command;
  command.setAttribute("data-lan-record-action-kind", kind);
  command.dataset.lanRecordActionDecorated = "true";
  command.classList.add("lan-record-command");
  if (!command.getAttribute("aria-label")) command.setAttribute("aria-label", label);
  if (!command.getAttribute("title")) command.setAttribute("title", label);
  const icon = document.createElement("span");
  icon.className = "lan-record-action-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = recordActionIcons[kind];
  const text = document.createElement("span");
  text.className = "lan-record-action-label";
  text.textContent = label;
  command.replaceChildren(icon, text);
  return command;
}

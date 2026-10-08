export const DEFAULT_RECORD_LIBRARY_PAGE_SIZE = 12;

export function normalizeRecordLibraryView(value = "grid") {
  return String(value || "").trim().toLowerCase() === "list" ? "list" : "grid";
}

export function applyRecordLibraryView(host, view = "grid") {
  if (!(host instanceof HTMLElement)) return "grid";
  const resolved = normalizeRecordLibraryView(view);
  host.dataset.lanRecordLibrary = "true";
  host.dataset.lanView = resolved;
  return resolved;
}

export function normalizeRecordLibraryPageSize(value, fallback = DEFAULT_RECORD_LIBRARY_PAGE_SIZE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function recordLibraryPageCount(records = [], pageSize = DEFAULT_RECORD_LIBRARY_PAGE_SIZE) {
  const size = normalizeRecordLibraryPageSize(pageSize);
  return Math.max(1, Math.ceil((Array.isArray(records) ? records.length : 0) / size));
}

export function recordLibraryPageSlice(records = [], page = 1, pageSize = DEFAULT_RECORD_LIBRARY_PAGE_SIZE) {
  const source = Array.isArray(records) ? records : [];
  const size = normalizeRecordLibraryPageSize(pageSize);
  const pages = recordLibraryPageCount(source, size);
  const currentPage = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * size;
  return { currentPage, totalPages: pages, items: source.slice(start, start + size), pageSize: size };
}

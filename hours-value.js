export function normalizeHours(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function formatHours(value) {
  const numeric = normalizeHours(value);
  if (numeric === null) return '';
  const amount = Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(2)));
  return `${amount} ${numeric === 1 ? 'hour' : 'hours'}`;
}

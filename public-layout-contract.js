const clean = (value = '') => String(value ?? '').trim().toLowerCase();

export const PUBLIC_LAYOUT_PRESETS = Object.freeze([
  'compact-full',
  'standard-half',
  'tall-half',
  'tall-narrow',
  'tall-wide',
  'standard-full',
  'large-full'
]);

export const PUBLIC_LAYOUT_MODES = Object.freeze(['auto','manual']);

export const PUBLIC_OVERFLOW_MODES = Object.freeze(['auto','vertical','horizontal','show-more','natural']);
export const PUBLIC_ROW_PAIRING_MODES = Object.freeze(['none','manual']);

const DEFAULT_PRESET_BY_SECTION = Object.freeze({
  about: 'tall-narrow',
  experience: 'tall-wide',
  projects: 'large-full',
  'photo-editing': 'standard-full',
  education: 'compact-full',
  certificates: 'standard-half',
  contact: 'standard-half',
  skills: 'standard-half',
  services: 'standard-half',
  resume: 'standard-half'
});

const LEGACY_PRESET_MAP = Object.freeze({
  auto: '',
  compact: 'standard-half',
  standard: 'standard-half',
  tall: 'tall-half',
  wide: 'standard-full',
  full: 'standard-full'
});

const LEGACY_WIDTH_PRESET = Object.freeze({
  'one-third':'standard-half',
  'half':'standard-half',
  'two-thirds':'standard-full',
  'full':'standard-full'
});

const PRESET_SPANS = Object.freeze({
  'compact-full': Object.freeze({ columns: 12, rows: 1 }),
  'standard-half': Object.freeze({ columns: 6, rows: 2 }),
  'tall-half': Object.freeze({ columns: 6, rows: 3 }),
  'tall-narrow': Object.freeze({ columns: 5, rows: 3 }),
  'tall-wide': Object.freeze({ columns: 7, rows: 3 }),
  'standard-full': Object.freeze({ columns: 12, rows: 2 }),
  'large-full': Object.freeze({ columns: 12, rows: 3 })
});

export function publicLayoutSpan(preset = 'standard-half') {
  const value = clean(preset);
  const span = PRESET_SPANS[value] || PRESET_SPANS['standard-half'];
  return { columns: span.columns, rows: span.rows };
}

export function isFullWidthPublicLayoutPreset(preset = '') {
  return publicLayoutSpan(preset).columns === 12;
}


export function canPairPublicLayoutPresets(left = '', right = '') {
  const a = clean(left);
  const b = clean(right);
  if (a === 'standard-half' && b === 'standard-half') return true;
  if (a === 'tall-half' && b === 'tall-half') return true;
  return (a === 'tall-narrow' && b === 'tall-wide') || (a === 'tall-wide' && b === 'tall-narrow');
}

export function publicLayoutFallbackPreset(preset = '') {
  const value = clean(preset);
  if (value === 'standard-half') return 'standard-full';
  if (['tall-half','tall-narrow','tall-wide'].includes(value)) return 'large-full';
  return PUBLIC_LAYOUT_PRESETS.includes(value) ? value : 'standard-full';
}

export function defaultPublicLayoutPreset(key = '') {
  return DEFAULT_PRESET_BY_SECTION[clean(key)] || 'standard-half';
}

export function suggestPublicLayoutPreset({ key = '', presentation = '', recordCount = 0 } = {}) {
  const sectionKey = clean(key);
  if (DEFAULT_PRESET_BY_SECTION[sectionKey]) return DEFAULT_PRESET_BY_SECTION[sectionKey];
  const mode = clean(presentation);
  const count = Math.max(0, Number(recordCount) || 0);
  if (mode === 'carousel' || mode === 'rich-showcase' || mode === 'featured-grid') return 'large-full';
  if (mode === 'media-gallery' || mode === 'grid') return 'standard-full';
  if (mode === 'timeline') return count > 1 ? 'tall-half' : 'standard-half';
  if (mode === 'list' || mode === 'text-section' || mode === 'cta-contact') return 'standard-half';
  return count > 4 ? 'standard-full' : 'standard-half';
}

export function compatiblePublicLayoutPresets({ key = '', presentation = '' } = {}) {
  const sectionKey = clean(key);
  const mode = clean(presentation);
  if (sectionKey === 'projects' || mode === 'carousel' || mode === 'rich-showcase' || mode === 'featured-grid') {
    return ['standard-full','large-full'];
  }
  if (sectionKey === 'photo-editing' || mode === 'media-gallery' || mode === 'grid') {
    return ['standard-full','large-full'];
  }
  if (sectionKey === 'about') return ['tall-narrow','standard-half','standard-full','large-full'];
  if (sectionKey === 'experience') return ['tall-wide','tall-half','standard-full','large-full'];
  if (sectionKey === 'education') return ['compact-full','standard-half','standard-full'];
  if (sectionKey === 'certificates' || sectionKey === 'contact') return ['standard-half','compact-full','standard-full'];
  if (mode === 'timeline') return ['standard-half','tall-half','standard-full','large-full'];
  if (mode === 'list' || mode === 'text-section' || mode === 'cta-contact') return ['standard-half','tall-half','standard-full'];
  return ['standard-half','tall-half','standard-full','large-full'];
}

function normalizePresetValue(raw = {}, fallback = '') {
  const layoutMode = normalizePublicLayoutMode(raw);
  if (layoutMode === 'auto') return suggestPublicLayoutPreset(raw);
  const explicit = clean(raw.layoutPreset);
  if (PUBLIC_LAYOUT_PRESETS.includes(explicit)) return explicit;
  const sectionKey = clean(raw.key);
  if (DEFAULT_PRESET_BY_SECTION[sectionKey]) return DEFAULT_PRESET_BY_SECTION[sectionKey];
  const legacy = LEGACY_PRESET_MAP[explicit];
  if (legacy) return legacy;
  const width = LEGACY_WIDTH_PRESET[clean(raw.width)];
  if (width) return width;
  return fallback || suggestPublicLayoutPreset(raw);
}

export function normalizePublicLayoutMode(raw = {}) {
  const explicit = clean(raw.layoutMode || raw.publicLayoutMode);
  if (PUBLIC_LAYOUT_MODES.includes(explicit)) return explicit;
  if (clean(raw.layoutPreset) === 'auto') return 'auto';
  if (PUBLIC_LAYOUT_PRESETS.includes(clean(raw.layoutPreset)) || clean(raw.width)) return 'manual';
  return 'auto';
}

export function normalizePublicLayoutConfig(raw = {}) {
  const layoutMode = normalizePublicLayoutMode(raw);
  const layoutPreset = normalizePresetValue(raw, raw.key ? defaultPublicLayoutPreset(raw.key) : '');
  const explicitOverflow = clean(raw.overflowMode);
  const overflowMode = PUBLIC_OVERFLOW_MODES.includes(explicitOverflow) ? explicitOverflow : 'auto';
  return { layoutMode, layoutPreset, overflowMode };
}

export function resolvePublicLayoutPreset(raw = {}) {
  return normalizePresetValue(raw, raw.key ? defaultPublicLayoutPreset(raw.key) : '');
}

export function resolvePublicOverflow(raw = {}) {
  const config = normalizePublicLayoutConfig(raw);
  if (config.overflowMode !== 'auto') return config.overflowMode;
  const mode = clean(raw.presentation);
  const preset = clean(raw.resolvedPreset || resolvePublicLayoutPreset(raw));
  if (clean(raw.contentKind) === 'generated') return mode === 'carousel' ? 'horizontal' : 'vertical';
  if (['media-gallery','carousel','rich-showcase','featured-grid','grid'].includes(mode)) return 'horizontal';
  if (['timeline','list','text-section','cards'].includes(mode)) return 'vertical';
  if (mode === 'cta-contact' && ['standard-half','tall-half','tall-narrow','tall-wide'].includes(preset)) return 'vertical';
  return 'natural';
}

export function normalizePublicRowPairing(raw = {}) {
  const stored = clean(raw.rowPairing);
  const explicit = raw.rowPairingExplicit === true || stored === 'none' || stored === 'manual';
  if (!explicit || stored === 'auto' || stored === 'new-row') return { mode:'none', partnerKey:'' };
  const mode = PUBLIC_ROW_PAIRING_MODES.includes(stored) ? stored : 'none';
  const partnerKey = mode === 'manual' ? clean(raw.rowPartnerKey) : '';
  return { mode, partnerKey };
}

export function planPublicLayoutRows(items = []) {
  const visible = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.content !== '')
    .map((item) => {
      const pairing = normalizePublicRowPairing(item);
      return {
        ...item,
        layoutMode: PUBLIC_LAYOUT_MODES.includes(clean(item.layoutMode)) ? clean(item.layoutMode) : 'auto',
        preset: PUBLIC_LAYOUT_PRESETS.includes(clean(item.preset)) ? clean(item.preset) : suggestPublicLayoutPreset(item),
        rowPairing: pairing.mode,
        rowPartnerKey: pairing.partnerKey
      };
    })
    .sort((a,b) => (Number(a.order)||0) - (Number(b.order)||0) || clean(a.key).localeCompare(clean(b.key)));

  const rows = [];
  for (let index = 0; index < visible.length; index += 1) {
    const item = visible[index];
    const span = publicLayoutSpan(item.preset);
    if (span.columns === 12) {
      rows.push({ kind:'full', items:[{ ...item, finalPreset:item.preset }] });
      continue;
    }

    const next = visible[index + 1];
    const compatible = Boolean(
      next &&
      !item.breakBefore &&
      !next.breakBefore &&
      publicLayoutSpan(next.preset).columns < 12 &&
      canPairPublicLayoutPresets(item.preset, next.preset)
    );
    const manualPair = compatible
      && item.rowPairing === 'manual'
      && next.rowPairing === 'manual'
      && clean(item.rowPartnerKey) === clean(next.key)
      && clean(next.rowPartnerKey) === clean(item.key);

    if (manualPair) {
      rows.push({
        kind:'cluster',
        items:[
          { ...item, finalPreset:item.preset },
          { ...next, finalPreset:next.preset }
        ]
      });
      index += 1;
      continue;
    }

    rows.push({ kind:'cluster', items:[{ ...item, finalPreset:item.preset }] });
  }
  return rows;
}

export function placementOrder(placement = '', coreOrders = {}) {
  const p = clean(placement);
  const order = (key, fallback) => Number(coreOrders[key]) || fallback;
  const midpoint = (a, b) => (a + b) / 2;
  const experience = order('experience', 200);
  const projects = order('projects', 300);
  const photo = order('photo-editing', 400);
  const education = order('education', 500);
  const certificates = order('certificates', 700);
  const contact = order('contact', 1000);
  if (p === 'after-experience') return midpoint(experience, projects);
  if (p === 'before-projects') return projects - 1;
  if (p === 'after-projects') return midpoint(projects, photo);
  if (p === 'before-photo-editing') return photo - 1;
  if (p === 'after-photo-editing') return midpoint(photo, education);
  if (p === 'before-education') return education - 1;
  if (p === 'after-education') return midpoint(education, certificates);
  if (p === 'before-contact') return contact - 1;
  return midpoint(photo, education);
}

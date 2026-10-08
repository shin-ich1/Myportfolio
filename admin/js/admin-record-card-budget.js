const GROUP_SELECTOR = ':scope [data-lan-record-overflow-group]';
const IDENTITY_SELECTOR = ':scope [data-lan-record-identity]';
const SUMMARY_SELECTOR = ':scope [data-lan-record-summary]';
const REGION_SELECTOR = ':scope [data-lan-record-overflow-region]';

// Lower numbers surrender space first. Narrative is not a group: it is
// protected until flexible chips/context have yielded their spare footprint.
const GROUP_PRIORITY = Object.freeze({ tags: 10, capabilities: 20, secondary: 30, metadata: 70, primary: 80 });
const FLEXIBLE_GROUPS = new Set(['tags', 'capabilities', 'secondary']);

function currentMode() {
  return document.documentElement.dataset.lanAdminMode || 'wide';
}

function resetCard(card, content) {
  content.querySelectorAll('[data-lan-budget-hidden="true"]').forEach((node) => {
    node.hidden = false;
    node.removeAttribute('data-lan-budget-hidden');
  });
  content.querySelectorAll('[data-lan-budget-collapsed-group="true"], [data-lan-budget-collapsed-region="true"]').forEach((node) => {
    node.hidden = false;
    node.removeAttribute('data-lan-budget-collapsed-group');
    node.removeAttribute('data-lan-budget-collapsed-region');
  });
  card.querySelectorAll(':scope > [data-lan-budget-shelf]').forEach((node) => node.remove());
  content.querySelectorAll('[data-lan-budget-overflow]').forEach((node) => node.remove());
  content.querySelectorAll('[data-lan-budget-summary="true"]').forEach((node) => {
    node.style.removeProperty('--lan-record-summary-lines');
    node.removeAttribute('data-lan-budget-summary');
  });
  content.querySelectorAll('[data-lan-budget-identity]').forEach((node) => {
    node.style.removeProperty('--lan-record-identity-lines');
    node.removeAttribute('data-lan-budget-identity');
  });
  content.removeAttribute('data-lan-budget-ready');
  content.removeAttribute('data-lan-budget-unresolved');
}

function isOverflowing(content) {
  return content.scrollHeight > content.clientHeight + 1;
}

function overflowShelf(content) {
  const card = content.parentElement;
  if (!card || typeof card.querySelector !== 'function' || typeof card.insertBefore !== 'function') throw new Error('Record-card overflow shelf requires its canonical card owner.');
  let shelf = card.querySelector(':scope > [data-lan-budget-shelf]');
  if (shelf) return shelf;
  shelf = document.createElement('div');
  shelf.className = 'lan-record-budget-overflow-shelf';
  shelf.setAttribute('data-lan-budget-shelf', 'true');
  card.insertBefore(shelf, card.querySelector(':scope > [data-lan-record-actions]'));
  return shelf;
}

function makeIndicator(group, label = '') {
  const indicator = document.createElement('span');
  indicator.className = 'lan-record-budget-more';
  indicator.setAttribute('data-lan-budget-overflow', 'true');
  indicator.setAttribute('data-lan-budget-overflow-for', group || 'detail');
  indicator.textContent = label;
  return indicator;
}

function hideNode(node) {
  node.hidden = true;
  node.setAttribute('data-lan-budget-hidden', 'true');
}

function semanticGroups(content) {
  return [...content.querySelectorAll(GROUP_SELECTOR)].map((group, domIndex) => {
    const name = String(group.dataset.lanRecordOverflowGroup || 'secondary').trim().toLowerCase();
    const explicitPriority = Number(group.dataset.lanRecordOverflowPriority);
    const priority = Number.isFinite(explicitPriority) && explicitPriority > 0
      ? explicitPriority
      : (GROUP_PRIORITY[name] || GROUP_PRIORITY.secondary);
    const items = [...group.children].filter((child) => !child.hidden && !child.hasAttribute('data-lan-budget-overflow') && !child.classList.contains('hidden'));
    return { group, name, priority, domIndex, items, indicator: null };
  }).filter(({ items }) => items.length)
    .sort((a, b) => a.priority - b.priority || b.domIndex - a.domIndex);
}

function collapseEmptyRegions(content) {
  content.querySelectorAll(REGION_SELECTOR).forEach((region) => {
    const meaningful = [...region.children].some((child) => !child.hidden && child.dataset.lanBudgetCollapsedGroup !== 'true');
    if (!meaningful) {
      region.hidden = true;
      region.setAttribute('data-lan-budget-collapsed-region', 'true');
    }
  });
}

function collapseGroupUntilFit(content, descriptor, minimumVisible = 0) {
  const { group, name, items } = descriptor;
  let indicator = descriptor.indicator;
  let hiddenCount = items.filter((item) => item.hidden || item.hasAttribute('data-lan-budget-hidden')).length;
  let visibleCount = items.length - hiddenCount;

  const updateIndicator = () => {
    if (!indicator) { indicator = makeIndicator(name); descriptor.indicator = indicator; }
    indicator.textContent = `+${hiddenCount} more`;
    if (visibleCount === 0) {
      overflowShelf(content).append(indicator);
      group.hidden = true;
      group.setAttribute('data-lan-budget-collapsed-group', 'true');
      collapseEmptyRegions(content);
    } else if (indicator.parentElement !== overflowShelf(content)) {
      overflowShelf(content).append(indicator);
    }
  };

  while (isOverflowing(content) && visibleCount > minimumVisible) {
    const node = [...items].reverse().find((item) => !item.hidden && !item.hasAttribute('data-lan-budget-hidden'));
    if (!node) break;
    hideNode(node);
    hiddenCount += 1;
    visibleCount -= 1;
    updateIndicator();
  }

  if (!hiddenCount && indicator) indicator.remove();
  return { hiddenCount, visibleCount };
}

function summaryNodes(content) {
  return [...content.querySelectorAll(SUMMARY_SELECTOR)];
}

function clampSummaries(content, lines) {
  summaryNodes(content).filter((summary) => !summary.hidden).forEach((summary) => {
    summary.setAttribute('data-lan-budget-summary', 'true');
    summary.style.setProperty('--lan-record-summary-lines', String(lines));
  });
}

function hideSummariesUntilFit(content) {
  const summaries = summaryNodes(content).filter((node) => !node.hidden);
  if (!summaries.length) return;
  let indicator = content.querySelector('[data-lan-budget-overflow-for="summary"]');
  let hiddenCount = 0;
  for (let index = summaries.length - 1; index >= 0 && isOverflowing(content); index -= 1) {
    hideNode(summaries[index]);
    hiddenCount += 1;
    if (!indicator) indicator = makeIndicator('summary');
    indicator.textContent = hiddenCount === 1 ? '+1 more detail' : `+${hiddenCount} more details`;
    overflowShelf(content).append(indicator);
  }
}

function clampIdentities(content, lines) {
  content.querySelectorAll(IDENTITY_SELECTOR).forEach((node) => {
    node.setAttribute('data-lan-budget-identity', 'true');
    node.style.setProperty('--lan-record-identity-lines', String(node.dataset.lanRecordIdentity === 'title' ? lines : 1));
  });
}

function budgetRecordCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.lanRecordCard !== 'true') return;
  const content = card.querySelector(':scope > [data-lan-record-content]');
  if (!(content instanceof HTMLElement)) return;

  resetCard(card, content);

  // Mobile uses natural card height. The same source content remains intact;
  // no saved information needs to be sacrificed to a fixed footprint.
  if (currentMode() === 'mobile') {
    content.setAttribute('data-lan-budget-ready', 'true');
    return;
  }

  if (!isOverflowing(content)) {
    content.setAttribute('data-lan-budget-ready', 'true');
    return;
  }

  const groups = semanticGroups(content);

  // 1) Narrative wins over opportunistic tags/tools/secondary context.
  for (const descriptor of groups.filter(({ name }) => FLEXIBLE_GROUPS.has(name))) {
    if (!isOverflowing(content)) break;
    collapseGroupUntilFit(content, descriptor, 0);
  }

  // 2) Only after flexible content has yielded do we shorten narrative.
  for (const lines of [5, 4, 3, 2, 1]) {
    if (!isOverflowing(content)) break;
    clampSummaries(content, lines);
  }

  // 3) Essential metadata is retained unless the footprint is still impossible.
  for (const descriptor of groups.filter(({ name }) => !FLEXIBLE_GROUPS.has(name))) {
    if (!isOverflowing(content)) break;
    collapseGroupUntilFit(content, descriptor, descriptor.name === 'primary' ? 1 : 0);
  }

  // 4) Identity is the last visual compression step before an unresolved flag.
  if (isOverflowing(content)) clampIdentities(content, 2);
  if (isOverflowing(content)) clampIdentities(content, 1);
  if (isOverflowing(content)) hideSummariesUntilFit(content);
  collapseEmptyRegions(content);

  content.setAttribute('data-lan-budget-ready', 'true');
  if (isOverflowing(content)) content.setAttribute('data-lan-budget-unresolved', 'true');
}

let sourceObserver;
let geometryObserver;
let queueSourceMutations;
const sourceObserverOptions = { childList: true, subtree: true, characterData: true };
const sourceRevision = new WeakMap();
const lastBudgetSignature = new WeakMap();
const observedGeometryHosts = new Set();
const dirtyGeometryHosts = new Set();
const geometryWidth = new WeakMap();
const pendingCards = new Set();
let flushFrame = 0;
let geometrySettleTimer = 0;

function cardSignature(card) {
  const content = card.querySelector(':scope > [data-lan-record-content]');
  if (!(content instanceof HTMLElement)) return '';
  const revision = sourceRevision.get(card) || 0;
  return [currentMode(), Math.round(content.clientWidth), revision].join(':');
}

function bumpSourceRevision(card) {
  sourceRevision.set(card, (sourceRevision.get(card) || 0) + 1);
  lastBudgetSignature.delete(card);
}

export function applyRecordCardBudget(card, { force = false } = {}) {
  if (!(card instanceof HTMLElement) || card.dataset.lanRecordCard !== 'true') return;
  const signature = cardSignature(card);
  if (!force && signature && lastBudgetSignature.get(card) === signature) return;

  const pendingMutations = sourceObserver?.takeRecords() || [];
  sourceObserver?.disconnect();
  try {
    budgetRecordCard(card);
    lastBudgetSignature.set(card, cardSignature(card));
  } finally {
    if (sourceObserver && document.body) sourceObserver.observe(document.body, sourceObserverOptions);
    if (pendingMutations.length) queueSourceMutations?.(pendingMutations);
  }
}

function flushPendingCards() {
  flushFrame = 0;
  const cards = [...pendingCards];
  pendingCards.clear();
  for (const card of cards) {
    if (card.isConnected) applyRecordCardBudget(card);
  }
}

export function scheduleRecordCardBudget(card, { force = false } = {}) {
  if (!(card instanceof HTMLElement) || card.dataset.lanRecordCard !== 'true') return;
  if (force) lastBudgetSignature.delete(card);
  pendingCards.add(card);
  if (flushFrame) return;
  flushFrame = requestAnimationFrame(flushPendingCards);
}

export function refreshRecordCardBudgets(root = document, { force = true } = {}) {
  root.querySelectorAll?.('[data-lan-record-card="true"]').forEach((card) => {
    if (force) lastBudgetSignature.delete(card);
    scheduleRecordCardBudget(card);
  });
}

function geometryHostForCard(card) {
  return card.closest('[data-lan-record-library="true"]') || card.parentElement;
}

function observeGeometryHosts() {
  if (!geometryObserver) return;
  observedGeometryHosts.forEach((host) => {
    if (!host.isConnected) {
      geometryObserver.unobserve(host);
      observedGeometryHosts.delete(host);
    }
  });
  document.querySelectorAll('[data-lan-record-card="true"]').forEach((card) => {
    const host = geometryHostForCard(card);
    if (!(host instanceof HTMLElement) || observedGeometryHosts.has(host)) return;
    observedGeometryHosts.add(host);
    geometryWidth.set(host, Math.round(host.getBoundingClientRect().width));
    geometryObserver.observe(host);
  });
}

function settleGeometryBudgets() {
  window.clearTimeout(geometrySettleTimer);
  geometrySettleTimer = window.setTimeout(() => {
    geometrySettleTimer = 0;
    const hosts = [...dirtyGeometryHosts];
    dirtyGeometryHosts.clear();
    for (const host of hosts) {
      if (!host.isConnected) continue;
      host.querySelectorAll?.('[data-lan-record-card="true"]').forEach((card) => scheduleRecordCardBudget(card, { force: true }));
    }
  }, 90);
}

function scheduleModeRefresh() {
  refreshRecordCardBudgets(document, { force: true });
}

let installed = false;
export function installRecordCardBudgetRuntime() {
  if (installed) return;
  installed = true;

  // The adaptive controller owns viewport measurement. The card budget listens
  // only to the semantic mode event plus actual library-width changes, avoiding
  // a second competing window-resize pipeline.
  window.addEventListener('lan:adaptive-mode-change', scheduleModeRefresh);

  if (typeof ResizeObserver === 'function') {
    geometryObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const host = entry.target;
        const nextWidth = Math.round(entry.contentRect.width);
        const previousWidth = geometryWidth.get(host);
        if (previousWidth === nextWidth) continue;
        geometryWidth.set(host, nextWidth);
        dirtyGeometryHosts.add(host);
        changed = true;
      }
      if (changed) settleGeometryBudgets();
    });
  }

  queueSourceMutations = (mutations) => {
    const cards = new Set();
    for (const mutation of mutations) {
      const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const card = element?.closest('[data-lan-record-card="true"]');
      if (card) cards.add(card);
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-lan-record-card="true"]')) cards.add(node);
        node.querySelectorAll?.('[data-lan-record-card="true"]').forEach((item) => cards.add(item));
      });
    }
    observeGeometryHosts();
    cards.forEach((card) => {
      bumpSourceRevision(card);
      scheduleRecordCardBudget(card);
    });
  };

  sourceObserver = new MutationObserver(queueSourceMutations);
  observeGeometryHosts();
  sourceObserver.observe(document.body, sourceObserverOptions);
  refreshRecordCardBudgets(document, { force: true });
  document.fonts?.ready.then(() => refreshRecordCardBudgets(document, { force: true }));
}


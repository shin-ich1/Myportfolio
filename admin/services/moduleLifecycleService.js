import {
  getSectionSource,
  listEntries,
  persistSectionLifecycleTransition,
  persistSectionLifecycleMeta,
  getSectionDeletionImpact as inspectSectionDeletionImpact,
  deleteSectionPermanently
} from './portfolioSectionService.js';
import {
  evaluateModuleChecks,
  selectModuleChecks,
  summarizeModuleChecks
} from '../../module-validation.js';
import { evaluateModuleMaturity } from '../../module-maturity.js';
import { deleteProject } from './projectService.js';
import { removeHomeSectionRegistration } from './homeService.js';

const HISTORY_LIMIT = 16;
const SAFE_ACTIVITY_FIELDS = Object.freeze([
  'type', 'timestamp', 'moduleKey', 'moduleId', 'lifecycle', 'previousLifecycle', 'currentLifecycle',
  'checkId', 'checkLabel', 'pass', 'passed', 'total', 'failed', 'entryCount', 'mediaAssetCount', 'linkedProjectCount', 'mode',
  'navigationActive', 'builderActive', 'homeRegistrationRemoved', 'message'
]);

const clean = (value = '') => String(value ?? '').trim();
const nowIso = () => new Date().toISOString();

function cloneReadiness(summary = {}) {
  return {
    total: Number(summary.total) || 0,
    passed: Number(summary.passed) || 0,
    failed: Number(summary.failed) || 0,
    ready: summary.ready === true,
    checks: (summary.checks || []).map((item) => ({
      id: item.id,
      label: item.label,
      pass: item.pass === true,
      reason: item.reason || ''
    })),
    missing: (summary.missing || []).map((item) => ({
      id: item.id,
      label: item.label,
      reason: item.reason || ''
    }))
  };
}

function boundedHistory(meta = {}) {
  return Array.isArray(meta.history) ? meta.history.slice(-HISTORY_LIMIT) : [];
}

function lifecycleMeta(section = {}) {
  return section.lifecycleMeta && typeof section.lifecycleMeta === 'object' && !Array.isArray(section.lifecycleMeta)
    ? section.lifecycleMeta
    : {};
}

function sanitizeActivity(payload = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const sanitized = {};
  SAFE_ACTIVITY_FIELDS.forEach((key) => {
    const value = source[key];
    if (value === undefined || value === null) return;
    if (['pass','navigationActive','builderActive','homeRegistrationRemoved'].includes(key)) sanitized[key] = value === true;
    else if (['passed','total','failed','entryCount','mediaAssetCount','linkedProjectCount'].includes(key)) sanitized[key] = Number(value) || 0;
    else sanitized[key] = clean(value);
  });
  sanitized.timestamp = clean(source.timestamp) || nowIso();
  return sanitized;
}

function activityEmitter(onActivity) {
  return (payload) => {
    const event = sanitizeActivity(payload);
    if (typeof onActivity === 'function') onActivity(event);
    return event;
  };
}

function dispatchSectionRefresh() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('lan:portfolio-sections-updated'));
  }
}

function snapshotForHistory(summary) {
  const cloned = cloneReadiness(summary);
  return {
    total: cloned.total,
    passed: cloned.passed,
    failed: cloned.failed,
    ready: cloned.ready,
    missing: cloned.missing.map((item) => item.id)
  };
}

function statusFrom(section, structural, runtimeSafety, entries) {
  const meta = lifecycleMeta(section);
  const lifecycle = section.lifecycle === 'promoted' ? 'promoted' : 'building';
  const entryCount = Array.isArray(entries) ? entries.length : 0;
  const maturity = evaluateModuleMaturity(section, entries);
  const promotionMode = lifecycle === 'promoted' ? clean(meta.promotionMode || 'automatic') : '';
  const automaticEligible = lifecycle === 'building' && structural.ready && runtimeSafety.ready && maturity.ready;
  return {
    section,
    moduleKey: section.key,
    moduleId: section.id,
    title: section.title,
    lifecycle,
    rawLifecycle: section.rawLifecycle || lifecycle,
    legacyLifecycle: section.legacyLifecycle || '',
    structural,
    runtimeSafety,
    maturity,
    readiness: structural,
    entryCount,
    automaticPromotion: lifecycle === 'promoted' ? 'completed' : automaticEligible ? 'eligible' : 'stabilizing',
    automaticPromotionEligible: automaticEligible,
    forcePromotionAvailable: lifecycle === 'building' && runtimeSafety.ready,
    promotionMode,
    promotedAt: clean(meta.promotedAt),
    demotedAt: clean(meta.demotedAt),
    readinessAtPromotion: meta.readinessAtPromotion || null,
    maturityAtPromotion: meta.maturityAtPromotion || null,
    navigationActive: lifecycle === 'promoted',
    builderActive: lifecycle !== 'promoted',
    history: boundedHistory(meta)
  };
}

export async function getModuleLifecycleStatus(sectionKey, options = {}) {
  const emit = activityEmitter(options.onActivity);
  const source = await getSectionSource(sectionKey);
  const section = source?.section || null;
  if (!section) throw new Error('This custom module no longer exists.');
  emit({ type:'module_loaded', moduleKey:section.key, moduleId:section.id, lifecycle:section.lifecycle });
  const validation = evaluateModuleChecks(source.raw);
  const structural = summarizeModuleChecks(validation, 'structural');
  const runtimeSafetyChecks = selectModuleChecks(validation, 'runtimeSafety');
  const runtimeSafety = summarizeModuleChecks(runtimeSafetyChecks, 'runtimeSafety');
  emit({ type:'structural_readiness', moduleKey:section.key, passed:structural.passed, total:structural.total, failed:structural.failed });
  runtimeSafetyChecks.forEach((item) => emit({ type:'check', moduleKey:section.key, checkId:item.id, checkLabel:item.label, pass:item.pass }));
  const entries = options.includeEntries === false ? [] : await listEntries(section.key, section);
  if (options.includeEntries !== false) emit({ type:'entry_count', moduleKey:section.key, entryCount:entries.length });
  return statusFrom(section, structural, runtimeSafety, entries);
}

async function transitionToPromoted(sectionKey, { mode, status, onActivity } = {}) {
  const emit = activityEmitter(onActivity);
  const current = status || await getModuleLifecycleStatus(sectionKey, { onActivity, includeEntries:true });
  if (current.lifecycle === 'promoted') return current;
  const completedAt = nowIso();
  const readinessAtPromotion = snapshotForHistory(current.structural);
  const maturityAtPromotion = {
    revision: current.maturity.currentRevision,
    passed: current.maturity.passed,
    total: current.maturity.total,
    ready: current.maturity.ready
  };
  const previousMeta = lifecycleMeta(current.section);
  const history = boundedHistory(previousMeta);
  const transition = {
    action: 'promote',
    from: current.lifecycle,
    to: 'promoted',
    mode,
    at: completedAt,
    readiness: readinessAtPromotion
  };
  emit({ type:'preserving_records', moduleKey:current.moduleKey, entryCount:current.entryCount, mode });
  emit({ type:'lifecycle_write_started', moduleKey:current.moduleKey, previousLifecycle:current.lifecycle, currentLifecycle:'promoted', mode });
  const persisted = await persistSectionLifecycleTransition(current.moduleId || current.moduleKey, {
    lifecycle: 'promoted',
    lifecycleMeta: {
      ...previousMeta,
      promotionMode: mode,
      promotedAt: completedAt,
      readinessAtPromotion,
      maturityAtPromotion,
      lastTransition: transition,
      history: [...history, transition].slice(-HISTORY_LIMIT)
    }
  });
  emit({ type:'lifecycle_write_confirmed', moduleKey:current.moduleKey, lifecycle:persisted?.lifecycle || 'promoted', mode });
  emit({ type:'navigation_state_updated', moduleKey:current.moduleKey, navigationActive:true });
  emit({ type:'workspace_state_updated', moduleKey:current.moduleKey, builderActive:false });
  dispatchSectionRefresh();
  const finalStatus = await getModuleLifecycleStatus(current.moduleKey, { includeEntries:true });
  emit({ type:'transition_complete', moduleKey:current.moduleKey, previousLifecycle:current.lifecycle, currentLifecycle:finalStatus.lifecycle, mode, entryCount:finalStatus.entryCount });
  return finalStatus;
}

export async function evaluateAutomaticPromotion(sectionKey, options = {}) {
  const status = await getModuleLifecycleStatus(sectionKey, { onActivity:options.onActivity, includeEntries:true });
  if (status.lifecycle !== 'building' || !status.structural.ready || !status.runtimeSafety.ready || !status.maturity.ready) {
    return { promoted:false, status };
  }
  const promotedStatus = await transitionToPromoted(sectionKey, { mode:'automatic', status, onActivity:options.onActivity });
  return { promoted:true, status:promotedStatus };
}

export async function recordModuleMaturityHydration(sectionKey, options = {}) {
  const source = await getSectionSource(sectionKey);
  const section = source?.section || null;
  if (!section) throw new Error('This custom module no longer exists.');
  const meta = lifecycleMeta(section);
  const revision = Math.max(0, Number(meta.structuralRevision) || 0);
  if (!revision) return section;
  const currentMaturity = meta.maturity && typeof meta.maturity === 'object' && !Array.isArray(meta.maturity)
    ? meta.maturity
    : {};
  const entries = Array.isArray(options.entries) ? options.entries : await listEntries(section.key, section);
  const sessionId = clean(options.sessionId);
  const currentEntries = entries.filter((entry) => Number(entry?.maturityRevision) === revision);
  const persistedAcrossSession = Boolean(sessionId) && currentEntries.some((entry) => clean(entry.maturitySessionId) && clean(entry.maturitySessionId) !== sessionId);
  const nextMaturity = {
    ...currentMaturity,
    revision,
    runtimeFailure: null
  };
  if (persistedAcrossSession) {
    nextMaturity.persistenceVerified = true;
    nextMaturity.persistenceVerifiedAt = nowIso();
    nextMaturity.persistenceSessionId = sessionId;
  }
  const unchanged = JSON.stringify(currentMaturity) === JSON.stringify(nextMaturity);
  if (unchanged) return section;
  return persistSectionLifecycleMeta(section.id || section.key, { ...meta, maturity: nextMaturity });
}

export async function recordModuleRuntimeFailure(sectionKey, error) {
  const source = await getSectionSource(sectionKey);
  const section = source?.section || null;
  if (!section) return null;
  const meta = lifecycleMeta(section);
  const revision = Math.max(0, Number(meta.structuralRevision) || 0);
  if (!revision) return section;
  const currentMaturity = meta.maturity && typeof meta.maturity === 'object' && !Array.isArray(meta.maturity) ? meta.maturity : {};
  const maturity = {
    ...currentMaturity,
    revision,
    runtimeFailure: { message: clean(error?.message || error || 'Module runtime failure.'), at: nowIso() }
  };
  return persistSectionLifecycleMeta(section.id || section.key, { ...meta, maturity });
}

export async function forcePromoteModule(sectionKey, options = {}) {
  const status = await getModuleLifecycleStatus(sectionKey, { onActivity:options.onActivity, includeEntries:true });
  if (status.lifecycle === 'promoted') return { promoted:false, alreadyPromoted:true, status };
  const runtimeSafety = status.runtimeSafety;
  if (!runtimeSafety.ready) {
    const error = new Error(runtimeSafety.missing[0]?.reason || 'This module cannot safely instantiate the promoted runtime.');
    error.code = 'MODULE_RUNTIME_UNSAFE';
    error.runtimeSafety = cloneReadiness(runtimeSafety);
    throw error;
  }
  const promotedStatus = await transitionToPromoted(sectionKey, { mode:'override', status, onActivity:options.onActivity });
  return { promoted:true, override:true, status:promotedStatus };
}

export async function demoteModule(sectionKey, options = {}) {
  const emit = activityEmitter(options.onActivity);
  const status = await getModuleLifecycleStatus(sectionKey, { onActivity:options.onActivity, includeEntries:true });
  if (status.lifecycle !== 'promoted') return { demoted:false, alreadyBuilding:true, status };
  const completedAt = nowIso();
  const previousMeta = lifecycleMeta(status.section);
  const history = boundedHistory(previousMeta);
  const transition = {
    action: 'demote',
    from: 'promoted',
    to: 'building',
    mode: clean(previousMeta.promotionMode || 'automatic'),
    at: completedAt,
    readiness: snapshotForHistory(status.structural)
  };
  emit({ type:'preserving_records', moduleKey:status.moduleKey, entryCount:status.entryCount });
  emit({ type:'lifecycle_write_started', moduleKey:status.moduleKey, previousLifecycle:'promoted', currentLifecycle:'building' });
  const persisted = await persistSectionLifecycleTransition(status.moduleId || status.moduleKey, {
    lifecycle: 'building',
    lifecycleMeta: {
      ...previousMeta,
      demotedAt: completedAt,
      lastTransition: transition,
      history: [...history, transition].slice(-HISTORY_LIMIT)
    }
  });
  emit({ type:'lifecycle_write_confirmed', moduleKey:status.moduleKey, lifecycle:persisted?.lifecycle || 'building' });
  emit({ type:'navigation_state_updated', moduleKey:status.moduleKey, navigationActive:false });
  emit({ type:'workspace_state_updated', moduleKey:status.moduleKey, builderActive:true });
  dispatchSectionRefresh();
  const finalStatus = await getModuleLifecycleStatus(status.moduleKey, { includeEntries:true });
  emit({ type:'transition_complete', moduleKey:status.moduleKey, previousLifecycle:'promoted', currentLifecycle:finalStatus.lifecycle, entryCount:finalStatus.entryCount });
  return { demoted:true, status:finalStatus };
}


export async function returnModuleToCustomHome(sectionKey, options = {}) {
  const emit = activityEmitter(options.onActivity);
  const status = await getModuleLifecycleStatus(sectionKey, { onActivity:options.onActivity, includeEntries:true });
  emit({ type:'preserving_records', moduleKey:status.moduleKey, entryCount:status.entryCount, mode:'return-custom' });
  emit({ type:'home_registration_remove_started', moduleKey:status.moduleKey, lifecycle:status.lifecycle });

  const homeRegistrationRemoved = await removeHomeSectionRegistration(status.moduleKey);
  if (!homeRegistrationRemoved) {
    emit({ type:'home_registration_removed', moduleKey:status.moduleKey, lifecycle:status.lifecycle, homeRegistrationRemoved:false, message:'not-registered' });
    return { returned:false, alreadyStaged:true, homeRegistrationRemoved:false, status };
  }

  const completedAt = nowIso();
  const previousMeta = lifecycleMeta(status.section);
  const history = boundedHistory(previousMeta);
  const transition = {
    action: 'return-custom',
    from: 'home-sections',
    to: 'custom-modules',
    mode: 'home-registration',
    at: completedAt
  };

  let historyRecorded = false;
  let finalStatus = status;
  try {
    await persistSectionLifecycleMeta(status.moduleId || status.moduleKey, {
      ...previousMeta,
      lastTransition: transition,
      history: [...history, transition].slice(-HISTORY_LIMIT)
    });
    historyRecorded = true;
    finalStatus = await getModuleLifecycleStatus(status.moduleKey, { includeEntries:true });
  } catch (error) {
    emit({ type:'history_write_failed', moduleKey:status.moduleKey, lifecycle:status.lifecycle, message:clean(error?.message || error) });
  }

  emit({ type:'home_registration_removed', moduleKey:status.moduleKey, lifecycle:status.lifecycle, homeRegistrationRemoved:true, entryCount:status.entryCount });
  dispatchSectionRefresh();
  return { returned:true, homeRegistrationRemoved:true, historyRecorded, status:finalStatus };
}

export async function getModuleDeletionImpact(sectionKey, options = {}) {
  const emit = activityEmitter(options.onActivity);
  const impact = await inspectSectionDeletionImpact(sectionKey);
  emit({
    type:'deletion_scan',
    moduleKey:impact.moduleKey,
    moduleId:impact.moduleId,
    lifecycle:impact.lifecycle,
    entryCount:impact.entryCount,
    message:impact.blocked ? 'blocked' : 'clear'
  });
  return impact;
}

async function writeDeletionProgress(moduleIdOrKey, section, progress, patch = {}) {
  const previousMeta = lifecycleMeta(section);
  Object.assign(progress, patch, { updatedAt: nowIso() });
  if (!progress.startedAt) progress.startedAt = nowIso();
  await persistSectionLifecycleMeta(moduleIdOrKey, {
    ...previousMeta,
    deletion: { ...progress }
  });
  return progress;
}

export async function deleteModulePermanently(sectionKey, options = {}) {
  const emit = activityEmitter(options.onActivity);
  const impact = await inspectSectionDeletionImpact(sectionKey);
  emit({
    type:'deletion_scan',
    moduleKey:impact.moduleKey,
    moduleId:impact.moduleId,
    lifecycle:impact.lifecycle,
    entryCount:impact.entryCount,
    mediaAssetCount:impact.mediaAssetCount,
    linkedProjectCount:impact.linkedProjects.length,
    message:impact.blocked ? 'blocked' : 'clear'
  });
  if (impact.blocked) {
    const error = new Error('Remove dependent Custom Module relationships before permanent deletion.');
    error.code = 'MODULE_DELETE_BLOCKED';
    error.impact = impact;
    throw error;
  }

  const source = await getSectionSource(impact.moduleId || impact.moduleKey);
  const section = source?.section || null;
  if (!section?.id) throw new Error('This custom module no longer exists.');
  const previousDeletion = lifecycleMeta(section).deletion;
  const attempt = Math.max(0, Number(previousDeletion?.attempt) || 0) + 1;
  const deletionProgress = previousDeletion && typeof previousDeletion === 'object' && !Array.isArray(previousDeletion)
    ? { ...previousDeletion }
    : {};
  let phase = 'intent';

  emit({
    type:'deletion_started',
    moduleKey:impact.moduleKey,
    moduleId:impact.moduleId,
    entryCount:impact.entryCount,
    mediaAssetCount:impact.mediaAssetCount,
    linkedProjectCount:impact.linkedProjects.length,
    message:attempt > 1 ? 'resume' : 'start'
  });

  await writeDeletionProgress(impact.moduleId || impact.moduleKey, section, deletionProgress, {
    state:'in-progress',
    phase,
    attempt,
    entryCount:impact.entryCount,
    mediaAssetCount:impact.mediaAssetCount,
    linkedProjectCount:impact.linkedProjects.length,
    lastError:''
  });

  try {
    // Permanent deletion is intentionally public-first: once the owner confirms
    // deletion, remove the Home composition registration before destructive
    // storage/database work. If a later phase fails, the module stays out of
    // Public while the same canonical deletion owner can be retried safely.
    phase = 'public-registration';
    const homeRegistrationRemoved = await removeHomeSectionRegistration(impact.moduleKey);
    await writeDeletionProgress(impact.moduleId || impact.moduleKey, section, deletionProgress, {
      state:'in-progress',
      phase,
      attempt,
      homeRegistrationRemoved
    });
    emit({
      type:'home_registration_removed',
      moduleKey:impact.moduleKey,
      moduleId:impact.moduleId,
      homeRegistrationRemoved,
      message:homeRegistrationRemoved ? 'removed' : 'not-registered'
    });

    phase = 'linked-projects';
    for (const project of impact.linkedProjects) {
      await deleteProject(project.id, { strictMediaCleanup:true });
    }
    await writeDeletionProgress(impact.moduleId || impact.moduleKey, section, deletionProgress, {
      state:'in-progress',
      phase,
      attempt,
      linkedProjectsRemoved:impact.linkedProjects.length
    });

    // deleteSectionPermanently remains the single owner for module-owned media,
    // entry records, and the registry document. It deletes the registry last,
    // so any failure before that point leaves a retryable owner document.
    phase = 'module-records';
    await writeDeletionProgress(impact.moduleId || impact.moduleKey, section, deletionProgress, {
      state:'in-progress',
      phase,
      attempt
    });
    const result = await deleteSectionPermanently(impact.moduleId || impact.moduleKey);

    const cascadeResult = {
      ...result,
      linkedProjectCount: impact.linkedProjects.length,
      linkedProjects: impact.linkedProjects,
      mediaAssetCount: impact.mediaAssetCount,
      homeRegistrationRemoved,
      resumed: attempt > 1
    };
    emit({
      type:'deletion_complete',
      moduleKey:impact.moduleKey,
      moduleId:impact.moduleId,
      entryCount:impact.entryCount,
      mediaAssetCount:impact.mediaAssetCount,
      linkedProjectCount:impact.linkedProjects.length,
      homeRegistrationRemoved,
      message:attempt > 1 ? 'resumed-complete' : 'complete'
    });
    dispatchSectionRefresh();
    return cascadeResult;
  } catch (error) {
    // Best-effort progress persistence only. Never mask the real deletion error.
    try {
      const current = await getSectionSource(impact.moduleId || impact.moduleKey);
      if (current?.section?.id) {
        await writeDeletionProgress(impact.moduleId || impact.moduleKey, current.section, deletionProgress, {
          state:'failed',
          phase,
          attempt,
          lastError:clean(error?.message || error)
        });
      }
    } catch {}
    emit({
      type:'deletion_failed',
      moduleKey:impact.moduleKey,
      moduleId:impact.moduleId,
      message:clean(error?.message || error)
    });
    throw error;
  }
}


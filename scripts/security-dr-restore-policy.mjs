/**
 * Canonical catastrophe-restore policy for the LΛN Firestore archive.
 *
 * This classifies authenticated archive records ONLY. It cannot write, deploy,
 * import a Firebase user, export TOTP material or authorize an Admin.
 * A recovery must be a forward repair: never resurrect pre-disaster
 * sessions, devices, security challenges, recovery keys or allowlist grants.
 */
const BASE = 'projects/rolando-portfolio-3f1a3/databases/(default)/documents/';
const CONTENT_ROOTS = new Set([
  'portfolio', 'experiences', 'projects', 'photoEditingProjects',
  'education', 'skills', 'certificates', 'resumes',
  'portfolioSections', 'portfolioSectionEntries'
]);
const validSegment = segment => typeof segment === 'string' && segment !== '.' &&
  segment !== '..' && !/^__.*__$/.test(segment) &&
  Buffer.byteLength(segment, 'utf8') > 0 && Buffer.byteLength(segment, 'utf8') <= 1500 &&
  !/[\\u0000-\\u001F\\u007F]/u.test(segment);
const LIMIT = 100000;

export function createSafeRecoveryScan(knownRootCollections) {
  if (!Array.isArray(knownRootCollections) || !knownRootCollections.length ||
      knownRootCollections.some(value => typeof value !== 'string') ||
      new Set(knownRootCollections).size !== knownRootCollections.length) {
    throw Error('Canonical Firestore root collection inventory required.');
  }
  const allowedRoots = new Set(knownRootCollections);
  for (const root of CONTENT_ROOTS) {
    if (!allowedRoots.has(root)) throw Error('DR content policy is not aligned with canonical Firestore inventory.');
  }
  const seen = new Set();
  const counts = { portfolioContentCandidates: 0, quarantinedSecurityAndPrivate: 0, missingTombstones: 0 };
  return Object.freeze({
    accept(row) {
      const resource = row?.document?.name;
      if (row?.type !== 'document' || typeof resource !== 'string' ||
          !resource.startsWith(BASE)) throw Error('Invalid DR archive document resource.');
      const segments = resource.slice(BASE.length).split('/');
      const permittedShape = segments.length === 2 ||
        (segments.length === 4 && segments[0] === 'privateMessageThreads' &&
          segments[2] === 'messages');
      if (!permittedShape || segments.some(segment => !validSegment(segment)) ||
          !allowedRoots.has(segments[0])) throw Error('Unreviewed DR archive document path.');
      if (seen.has(resource) || seen.size >= LIMIT) throw Error('Repeated or oversized DR archive inventory.');
      seen.add(resource);
      const missing = row.missing === true;
      const hasFields = Object.hasOwn(row.document, 'fields');
      if (missing === hasFields ||
          (hasFields && (!row.document.fields || typeof row.document.fields !== 'object' ||
            Array.isArray(row.document.fields)))) {
        throw Error('Malformed DR archive document fields.');
      }
      if (missing) counts.missingTombstones++;
      else if (CONTENT_ROOTS.has(segments[0]) && segments.length === 2) counts.portfolioContentCandidates++;
      else counts.quarantinedSecurityAndPrivate++;
    },
    finish(authenticated, records) {
      if (authenticated !== true || !Number.isSafeInteger(records) ||
          records !== seen.size ||
          counts.portfolioContentCandidates + counts.quarantinedSecurityAndPrivate +
          counts.missingTombstones !== records) {
        throw Error('Authenticated DR inventory is incomplete.');
      }
      // Numbers only: never release names, paths, document fields, or secrets.
      return Object.freeze({
        ...counts, authenticated: true,
        historicalSecurityStateExcludedFromCandidates: true,
        freshIdentityAndMfaRequired: true,
        writeOperations: 0
      });
    }
  });
}

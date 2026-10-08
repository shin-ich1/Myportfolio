import {
  resolveModuleEntryCardSemantics,
  resolveModulePrimaryMediaField,
  resolveModuleCoverField,
  resolveModuleFieldSemanticRole
} from './module-platform.js';
import { resolveAssetUrl } from './asset-resolver.js';
import {
  classifyPortfolioFile,
  resolvePortfolioFieldAssetAccess,
  sourceAssetPublicBehavior
} from './file-type-registry.js';

const clean = (value = '') => String(value ?? '').trim();
const IMAGE_FIELD_TYPES = new Set(['image', 'images', 'gallery']);
const MEDIA_FIELD_TYPES = new Set(['image', 'images', 'gallery', 'video', 'audio']);
const ASSET_FIELD_TYPES = new Set(['image', 'images', 'gallery', 'video', 'audio', 'pdf', 'document', 'file', 'project-file', 'files']);

function mediaValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value === null || value === undefined || value === '' ? [] : [value];
}

function familyFor(field = {}, asset = null) {
  const type = clean(field?.type).toLowerCase();
  if (IMAGE_FIELD_TYPES.has(type)) return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return asset ? classifyPortfolioFile(asset).family : '';
}

function publicBehaviorDescriptor(asset, family) {
  if (!asset) return {};
  if (typeof asset === 'string') return { url: asset, fileFamily: family };
  if (typeof asset !== 'object') return {};
  return asset.fileFamily ? asset : { ...asset, fileFamily: family };
}

/**
 * Canonical portfolio asset presentation resolver.
 *
 * This is intentionally not module-specific. Core pages (Projects, Photo
 * Editing, Resume, etc.), generated modules and future modules all need the
 * same decision for managed-provider identity, access and public delivery.
 * Schema-aware callers pass their field; core callers may pass a family/type
 * hint. No page owns a second storage URL resolver.
 */
export function isPortfolioAssetPresentation(value = null) {
  return Boolean(
    value
    && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, 'asset')
    && Object.prototype.hasOwnProperty.call(value, 'family')
    && Object.prototype.hasOwnProperty.call(value, 'publicAllowed')
    && Object.prototype.hasOwnProperty.call(value, 'publicDisplayUrl')
  );
}

export function resolvePortfolioAssetPresentation(asset = null, options = {}) {
  if (isPortfolioAssetPresentation(asset)) {
    const prior = asset;
    if (!prior.asset) return prior;
    const displayUrl = clean(
      resolveAssetUrl(prior.asset, 'display')
      || resolveAssetUrl(prior.asset, 'preview')
      || resolveAssetUrl(prior.asset, 'admin-read')
    );
    const cardUrl = clean(resolveAssetUrl(prior.asset, 'card') || resolveAssetUrl(prior.asset, 'preview') || displayUrl);
    const detailUrl = clean(resolveAssetUrl(prior.asset, 'detail') || displayUrl);
    const originalUrl = clean(resolveAssetUrl(prior.asset, 'original') || displayUrl);
    const renderable = Boolean(prior.asset) && (
      ['image', 'video', 'audio'].includes(prior.family)
        ? Boolean(displayUrl)
        : true
    );
    const adminUrl = prior.family === 'image' ? (cardUrl || displayUrl) : displayUrl;
    const publicDisplayUrl = renderable && prior.publicAllowed ? displayUrl : '';
    const publicCardUrl = renderable && prior.publicAllowed ? cardUrl : '';
    const publicDetailUrl = renderable && prior.publicAllowed ? detailUrl : '';
    const publicOriginalUrl = renderable && prior.publicAllowed ? originalUrl : '';
    return Object.freeze({
      ...prior,
      displayUrl,
      adminUrl,
      cardUrl,
      detailUrl,
      originalUrl,
      publicDisplayUrl,
      publicCardUrl,
      publicDetailUrl,
      publicOriginalUrl,
      publicUrl: publicDisplayUrl,
      renderable,
      adminRenderable: renderable,
      publicRenderable: Boolean(publicDisplayUrl)
        || (renderable && prior.publicAllowed && !['image', 'video', 'audio'].includes(prior.family))
    });
  }
  const suppliedField = options?.field && typeof options.field === 'object' ? options.field : {};
  const hintedType = clean(options?.type || suppliedField?.type).toLowerCase();
  const hintedFamily = clean(options?.family).toLowerCase();
  const field = {
    ...suppliedField,
    ...(hintedType ? { type: hintedType } : {}),
    ...(options?.access ? { access: clean(options.access).toLowerCase() } : {}),
    ...(options?.public !== undefined ? { public: options.public !== false } : {})
  };
  const family = hintedFamily || familyFor(field, asset);
  const fieldPolicy = clean(field?.access || field?.accessPolicy).toLowerCase();
  const mediaType = clean(field?.type || family).toLowerCase();
  const publicMediaField = MEDIA_FIELD_TYPES.has(mediaType) && field?.public !== false;

  // Typed public media defaults to public-preview. Upload transaction defaults
  // must never silently turn a public schema field into an Admin-only surface.
  const policyField = publicMediaField && !fieldPolicy
    ? { ...field, access: 'public-preview' }
    : field;
  const access = resolvePortfolioFieldAssetAccess(policyField, asset || {});
  const publicBehavior = sourceAssetPublicBehavior(publicBehaviorDescriptor(asset, family), access);

  const displayUrl = asset
    ? clean(resolveAssetUrl(asset, 'display') || resolveAssetUrl(asset, 'preview') || resolveAssetUrl(asset, 'admin-read'))
    : '';
  const cardUrl = asset ? clean(resolveAssetUrl(asset, 'card') || resolveAssetUrl(asset, 'preview') || displayUrl) : '';
  const detailUrl = asset ? clean(resolveAssetUrl(asset, 'detail') || displayUrl) : '';
  const originalUrl = asset ? clean(resolveAssetUrl(asset, 'original') || displayUrl) : '';
  const renderable = Boolean(asset) && (['image', 'video', 'audio'].includes(family) ? Boolean(displayUrl) : true);
  const publicAllowed = field?.public !== false
    && Boolean(publicBehavior.public)
    && (!['image', 'video', 'audio'].includes(family) || Boolean(publicBehavior.embed));
  const adminUrl = family === 'image' ? (cardUrl || displayUrl) : displayUrl;
  const publicDisplayUrl = renderable && publicAllowed ? displayUrl : '';
  const publicCardUrl = renderable && publicAllowed ? cardUrl : '';
  const publicDetailUrl = renderable && publicAllowed ? detailUrl : '';
  const publicOriginalUrl = renderable && publicAllowed ? originalUrl : '';

  return Object.freeze({
    asset,
    family,
    access,
    publicBehavior,
    displayUrl,
    adminUrl,
    cardUrl,
    detailUrl,
    originalUrl,
    publicDisplayUrl,
    publicCardUrl,
    publicDetailUrl,
    publicOriginalUrl,
    publicUrl: publicDisplayUrl,
    renderable,
    publicAllowed,
    adminRenderable: renderable,
    publicRenderable: Boolean(publicDisplayUrl) || (renderable && publicAllowed && !['image', 'video', 'audio'].includes(family))
  });
}

/**
 * Schema-aware adapter used by generated modules. It deliberately delegates to
 * the portfolio-wide owner above so card/detail/core surfaces cannot drift.
 */
export function resolveModuleFieldAssetPresentation(field = {}, asset = null) {
  return resolvePortfolioAssetPresentation(asset, { field });
}

export function resolveModuleFieldAssetPresentations(field = {}, value = null) {
  return Object.freeze(mediaValues(value).map((asset) => resolveModuleFieldAssetPresentation(field, asset)));
}

function fieldValue(semantics = {}, entry = {}, field = {}) {
  return semantics?.data?.[field.key] ?? entry?.data?.[field.key] ?? entry?.[field.key];
}

function fieldGroup(semantics, entry, field) {
  const items = resolveModuleFieldAssetPresentations(field, fieldValue(semantics, entry, field));
  return Object.freeze({
    field,
    role: resolveModuleFieldSemanticRole(field),
    family: familyFor(field, items[0]?.asset || null),
    items,
    adminItems: Object.freeze(items.filter((item) => item.adminRenderable)),
    publicItems: Object.freeze(items.filter((item) => item.publicRenderable)),
    // Public candidates preserve the semantic presence of an allowed asset even
    // when its delivery URL is temporarily unavailable. Renderers can then show
    // the canonical fallback instead of silently dropping the media slot.
    publicCandidateItems: Object.freeze(items.filter((item) => item.publicAllowed))
  });
}

function firstGroup(groups = [], predicate = () => true) {
  return groups.find((group) => predicate(group)) || null;
}

function firstItem(groups = [], key = 'publicItems') {
  for (const group of groups) {
    const item = group?.[key]?.[0];
    if (item) return item;
  }
  return null;
}

/**
 * Canonical module-record media resolution.
 *
 * A module record is resolved as one semantic media presentation, not as one
 * page-specific cover field. This lets future comparison, gallery, image and
 * video modules inherit the same behavior without module-name exceptions.
 */
export function resolveModuleRecordMedia(section = {}, entry = {}) {
  const semantics = resolveModuleEntryCardSemantics(section, entry);
  const module = semantics.module || section || {};
  const fields = Array.isArray(module.fields) ? module.fields : [];
  const coverField = resolveModuleCoverField(fields, {
    displayImageField: semantics.displayImageField || module.display?.imageField || ''
  });
  const schemaField = resolveModulePrimaryMediaField(fields, {
    displayImageField: coverField?.key || semantics.displayImageField || module.display?.imageField || ''
  });
  const declaredPrimaryField = coverField || semantics.primaryMediaField || schemaField || null;
  const mediaFields = fields.filter((field) => MEDIA_FIELD_TYPES.has(clean(field?.type).toLowerCase()));

  for (const candidate of [coverField, declaredPrimaryField]) {
    if (candidate
      && ASSET_FIELD_TYPES.has(clean(candidate?.type).toLowerCase())
      && !mediaFields.some((field) => clean(field?.key) === clean(candidate?.key))) {
      mediaFields.unshift(candidate);
    }
  }

  const groups = Object.freeze(mediaFields.map((field) => fieldGroup(semantics, entry, field)));
  const coverGroup = coverField
    ? firstGroup(groups, (group) => clean(group.field?.key) === clean(coverField.key))
    : null;
  const preferredKey = declaredPrimaryField?.key || '';
  const preferredGroup = firstGroup(groups, (group) => clean(group.field?.key) === clean(preferredKey));
  const populatedGroup = firstGroup(groups, (group) => group.items.length > 0);
  const preferredPublicGroup = preferredGroup?.publicItems?.length ? preferredGroup : null;
  const firstPublicGroup = firstGroup(groups, (group) => group.publicItems.length > 0);
  const preferredAdminGroup = preferredGroup?.adminItems?.length ? preferredGroup : null;
  const firstAdminGroup = firstGroup(groups, (group) => group.adminItems.length > 0);
  const preferredCandidateGroup = preferredGroup?.publicCandidateItems?.length ? preferredGroup : null;
  const firstCandidateGroup = firstGroup(groups, (group) => group.publicCandidateItems.length > 0);

  const primaryGroup = preferredGroup
    || preferredPublicGroup
    || preferredAdminGroup
    || firstAdminGroup
    || firstPublicGroup
    || preferredCandidateGroup
    || firstCandidateGroup
    || populatedGroup
    || groups[0]
    || null;
  const field = coverField || primaryGroup?.field || declaredPrimaryField || null;
  const presentationGroup = coverGroup || primaryGroup || null;
  const items = presentationGroup?.items || Object.freeze([]);

  const secondaryAdminItem = (preferredAdminGroup || firstAdminGroup)?.adminItems?.[0] || null;
  const secondaryPublicItem = (preferredPublicGroup || firstPublicGroup)?.publicItems?.[0] || null;
  const secondaryPublicCandidateItem = secondaryPublicItem || (preferredCandidateGroup || firstCandidateGroup)?.publicCandidateItems?.[0] || null;
  const first = items[0] || resolveModuleFieldAssetPresentation(coverField || {}, null);

  const imageGroups = groups.filter((group) =>
    IMAGE_FIELD_TYPES.has(clean(group.field?.type).toLowerCase())
    || group.family === 'image'
    || group.items.some((item) => item?.family === 'image')
  );
  const allAdminImageItems = Object.freeze(imageGroups.flatMap((group) => group.adminItems));
  const allPublicImageItems = Object.freeze(imageGroups.flatMap((group) => group.publicItems));
  const allPublicImageCandidateItems = Object.freeze(imageGroups.flatMap((group) => group.publicCandidateItems));
  const allPublicItems = Object.freeze(groups.flatMap((group) => group.publicItems));
  const allPublicCandidateItems = Object.freeze(groups.flatMap((group) => group.publicCandidateItems));

  const comparisonBefore = firstGroup(groups, (group) => group.role === 'comparison-before');
  const comparisonAfter = firstGroup(groups, (group) => group.role === 'comparison-after');
  const comparison = comparisonBefore || comparisonAfter
    ? Object.freeze({
        before: comparisonBefore?.publicItems?.[0] || null,
        after: comparisonAfter?.publicItems?.[0] || null,
        publicBeforeCandidate: comparisonBefore?.publicCandidateItems?.[0] || null,
        publicAfterCandidate: comparisonAfter?.publicCandidateItems?.[0] || null,
        adminBefore: comparisonBefore?.adminItems?.[0] || null,
        adminAfter: comparisonAfter?.adminItems?.[0] || null
      })
    : null;

  const galleryGroups = groups.filter((group) => group.role === 'gallery' || ['images', 'gallery'].includes(clean(group.field?.type).toLowerCase()));
  const galleryPublicItems = Object.freeze(galleryGroups.flatMap((group) => group.publicItems));
  const galleryPublicCandidateItems = Object.freeze(galleryGroups.flatMap((group) => group.publicCandidateItems));
  const galleryAdminItems = Object.freeze(galleryGroups.flatMap((group) => group.adminItems));

  // Cover remains a strict structural owner when the schema actually declares
  // one. Without a Cover field, the populated semantic primary media owns the
  // card instead of inventing a fake Cover slot.
  const adminCoverItem = coverGroup?.adminItems?.find((item) => item.family === 'image') || null;
  const publicCoverItem = coverGroup?.publicItems?.find((item) => item.family === 'image') || null;
  const publicCoverCandidateItem = publicCoverItem
    || coverGroup?.publicCandidateItems?.find((item) => item.family === 'image')
    || null;
  const publicCoverField = coverField || null;

  const supportsMedia = mediaFields.length > 0;
  const supportsCover = Boolean(coverField);
  const hasAsset = groups.some((group) => group.items.length > 0);
  const primaryFieldType = clean(field?.type).toLowerCase();
  const primaryAdminItem = presentationGroup?.adminItems?.[0] || null;
  const primaryPublicItem = presentationGroup?.publicItems?.[0] || null;
  const primaryPublicCandidateItem = primaryPublicItem || presentationGroup?.publicCandidateItems?.[0] || null;

  let cardMediaKind = 'none';
  if (supportsCover) cardMediaKind = 'image';
  else if (comparison && (comparison.adminBefore || comparison.adminAfter || comparison.publicBeforeCandidate || comparison.publicAfterCandidate)) cardMediaKind = 'comparison';
  else if (['gallery', 'images'].includes(primaryFieldType) && presentationGroup?.items?.length) cardMediaKind = 'gallery';
  else if (primaryFieldType === 'image' && presentationGroup?.items?.length) cardMediaKind = 'image';
  else if (primaryFieldType === 'video' && presentationGroup?.items?.length) cardMediaKind = 'video';

  const supportsCardMedia = cardMediaKind !== 'none';
  const adminItem = supportsCover ? adminCoverItem : primaryAdminItem;
  const publicItem = supportsCover ? publicCoverItem : primaryPublicItem;
  const publicCandidateItem = supportsCover ? publicCoverCandidateItem : primaryPublicCandidateItem;
  const publicDisplayUrl = publicCandidateItem?.publicDisplayUrl || publicItem?.publicDisplayUrl || '';
  const adminDisplayUrl = adminItem?.adminUrl || adminItem?.displayUrl || '';

  return Object.freeze({
    semantics,
    field,
    coverField,
    fields: Object.freeze(mediaFields),
    groups,
    primaryGroup,
    coverGroup,
    supportsMedia,
    supportsCover,
    supportsCardMedia,
    hasAsset,
    family: first.family || 'image',
    items,
    first,
    adminItem,
    adminCoverItem,
    publicItem,
    publicCandidateItem,
    secondaryAdminItem,
    secondaryPublicItem,
    secondaryPublicCandidateItem,
    adminDisplayUrl,
    publicDisplayUrl,
    adminRenderable: Boolean(adminCoverItem),
    publicRenderable: Boolean(publicCoverItem),
    allAdminImageItems,
    allPublicImageItems,
    allPublicImageCandidateItems,
    allPublicCandidateItems,
    publicCoverItem,
    publicCoverCandidateItem,
    publicCoverField,
    galleryAdminItems,
    galleryPublicItems,
    galleryPublicCandidateItems,
    comparison,
    cardMediaKind,
    useAdminFallbackCover: supportsCover && !adminCoverItem,
    usePublicFallbackCover: supportsCover && !publicCoverItem
  });
}

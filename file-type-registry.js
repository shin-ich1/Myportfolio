const clean = (value = '') => String(value ?? '').trim();
const lower = (value = '') => clean(value).toLowerCase();
const extOf = (name = '') => { const source = lower(name).split(/[?#]/)[0]; const match = source.match(/(\.[a-z0-9]+)$/); return match ? match[1] : ''; };
const list = (value) => Object.freeze(value.split(/\s+/).filter(Boolean));


const SOURCE_ACCESS_POLICIES = new Set(['admin-only', 'metadata-only', 'public-preview', 'public-download']);

export function resolvePortfolioFieldAssetAccess(field = {}, file = {}) {
  const fieldPolicy = lower(field.access || field.accessPolicy);
  if (SOURCE_ACCESS_POLICIES.has(fieldPolicy)) return fieldPolicy;
  const assetPolicy = lower(file.access || file.accessPolicy);
  if (SOURCE_ACCESS_POLICIES.has(assetPolicy)) return assetPolicy;
  return lower(field.type) === 'project-file' ? 'admin-only' : 'public-preview';
}

export async function normalizePortfolioPdfBlob(blob) {
  if (!blob || typeof blob.slice !== 'function') return null;
  const header = await blob.slice(0, 1024).text();
  if (!header.includes('%PDF-')) return null;
  if (lower(blob.type) === 'application/pdf') return blob;
  return new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
}


export function buildMicrosoftOfficeEmbedUrl(source = '') {
  const value = clean(source);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(parsed.href)}`;
  } catch {
    return '';
  }
}

export const FILE_TYPE_REGISTRY = Object.freeze([
  { family: 'image', label: 'Image', extensions: list('.jpg .jpeg .png .webp .gif .svg .avif'), mimePrefixes: ['image/'], preview: 'image', uploadResource: 'image', executablePublic: false },
  { family: 'video', label: 'Video', extensions: list('.mp4 .mov .webm .m4v .avi .mkv'), mimePrefixes: ['video/'], preview: 'video', uploadResource: 'video', executablePublic: false },
  { family: 'audio', label: 'Audio', extensions: list('.mp3 .wav .m4a .aac .ogg .flac'), mimePrefixes: ['audio/'], preview: 'audio', uploadResource: 'video', executablePublic: false },
  { family: 'pdf', label: 'PDF', extensions: list('.pdf'), mimes: ['application/pdf'], preview: 'pdf', uploadResource: 'image', executablePublic: false },
  { family: 'document', label: 'Document / Office', extensions: list('.doc .docx .xls .xlsx .ppt .pptx .txt .rtf .odt .ods .key .pages .numbers'), mimePrefixes: ['text/', 'application/vnd.', 'application/msword'], preview: 'metadata', uploadResource: 'raw', executablePublic: false },
  { family: 'design-source', label: 'Design Source', extensions: list('.psd .psb .ai .indd .fig .xd .sketch .xcf .kra'), preview: 'metadata', uploadResource: 'raw', executablePublic: false },
  { family: '3d-source', label: '3D / CAD Source', extensions: list('.blend .max .ma .mb .c4d .hip .zpr .ztl .dwg .sldprt .sldasm'), preview: 'metadata', uploadResource: 'raw', executablePublic: false },
  { family: 'video-project', label: 'Video Project', extensions: list('.prproj .aep .drp .fcp .vep'), preview: 'metadata', uploadResource: 'raw', executablePublic: false },
  { family: 'audio-project', label: 'Audio Project', extensions: list('.als .flp .ptx .cpr .logic .rpp'), preview: 'metadata', uploadResource: 'raw', executablePublic: false },
  { family: 'code-source', label: 'Code / Data Source', extensions: list('.html .htm .css .js .mjs .cjs .py .java .cpp .c .h .hpp .json .xml .csv'), mimePrefixes: ['text/'], preview: 'metadata', uploadResource: 'raw', executablePublic: false }
]);

export function classifyPortfolioFile(file = {}) {
  const urlName = clean(file.url || file.secureUrl || file.secure_url).split(/[?#]/)[0].split('/').filter(Boolean).at(-1) || '';
  const name = clean(file.name || file.originalFilename || file.displayName || file.filename || urlName);
  const mime = lower(file.type || file.mimeType || file.mime || '');
  const ext = extOf(name) || extOf(urlName);
  const storedFamily = lower(file.fileFamily || '');
  const hinted = storedFamily ? FILE_TYPE_REGISTRY.find((item) => item.family === storedFamily) : null;
  if (hinted) return { ...hinted, extension: ext, mime, name };
  const found = FILE_TYPE_REGISTRY.find((item) => item.extensions.includes(ext) || (mime && item.mimes?.includes(mime)) || (mime && item.mimePrefixes?.some((prefix) => mime.startsWith(prefix))));
  return found ? { ...found, extension: ext, mime, name } : { family: 'generic', label: 'File', extensions: [], preview: 'metadata', uploadResource: 'raw', executablePublic: false, extension: ext, mime, name };
}

export function resolvePortfolioUploadResource(file = {}, requested = 'auto') {
  const info = classifyPortfolioFile(file);
  if (info.family !== 'generic' && info.uploadResource) return info.uploadResource;
  const explicit = lower(requested);
  return ['image', 'video', 'raw'].includes(explicit) ? explicit : 'raw';
}

export function sourceAssetPublicBehavior(file = {}, access = 'admin-only') {
  const info = classifyPortfolioFile(file);
  const policy = lower(access || 'admin-only');
  if (policy === 'admin-only') return { public: false, download: false, embed: false, metadata: false };
  if (policy === 'metadata-only') return { public: true, download: false, embed: false, metadata: true };
  if (policy === 'public-download') return { public: true, download: true, embed: false, metadata: true };
  const safeEmbed = ['image', 'video', 'audio', 'pdf'].includes(info.family) && !['code-source', 'design-source', '3d-source', 'video-project', 'audio-project'].includes(info.family);
  return { public: true, download: false, embed: safeEmbed, metadata: true };
}

export function validatePortfolioFileDescriptor(file = {}) {
  const size = Number(file.size ?? file.bytes ?? 0);
  if (!(size > 0)) return { valid: false, reason: 'File is empty.' };
  const info = classifyPortfolioFile(file);
  const mime = lower(file.type || file.mimeType || file.mime || '');
  if (mime && info.family === 'image' && !mime.startsWith('image/')) return { valid: false, reason: 'Image extension does not match its MIME type.' };
  if (mime && info.family === 'video' && !mime.startsWith('video/')) return { valid: false, reason: 'Video extension does not match its MIME type.' };
  if (mime && info.family === 'audio' && !mime.startsWith('audio/')) return { valid: false, reason: 'Audio extension does not match its MIME type.' };
  if (mime && info.family === 'pdf' && mime !== 'application/pdf') return { valid: false, reason: 'PDF extension does not match its MIME type.' };
  return { valid: true, reason: '', info };
}

export function fileAcceptString(families = []) {
  const wanted = Array.isArray(families) ? families : [families];
  return FILE_TYPE_REGISTRY.filter((item) => wanted.includes(item.family)).flatMap((item) => item.extensions).join(',');
}

export function fieldAcceptForSchema(field = {}) {
  const preset = lower(field.acceptPreset || '');
  if (preset === 'custom') return clean(field.accept);
  if (preset === 'documents') return fileAcceptString(['document', 'pdf']);
  if (preset === 'images') return 'image/*';
  if (preset === 'video') return 'video/*';
  if (preset === 'audio') return 'audio/*';
  if (preset === 'source') return fileAcceptString(['design-source', '3d-source', 'video-project', 'audio-project', 'code-source', 'document', 'pdf']);
  if (preset === 'any') return clean(field.accept);
  if (['image', 'images', 'gallery'].includes(field.type)) return 'image/*';
  if (field.type === 'video') return 'video/*';
  if (field.type === 'audio') return 'audio/*';
  if (field.type === 'pdf') return fileAcceptString(['pdf']);
  if (field.type === 'document') return fileAcceptString(['document', 'pdf']);
  if (field.type === 'project-file') return fileAcceptString(['design-source', '3d-source', 'video-project', 'audio-project', 'code-source', 'document', 'pdf']);
  return clean(field.accept);
}
export function resolvePortfolioFilePreview(file = {}, access = 'admin-only') {
  const info = classifyPortfolioFile(file);
  const policy = lower(access || 'admin-only');
  if (policy === 'admin-only') return { kind: 'private', inline: false, download: false };
  if (policy === 'metadata-only') return { kind: 'metadata', inline: false, download: false };
  const download = policy === 'public-download';
  const extension = lower(info.extension);
  if (info.family === 'image') return { kind: 'image', inline: true, download };
  if (info.family === 'video') return { kind: 'video', inline: true, download };
  if (info.family === 'audio') return { kind: 'audio', inline: true, download };
  if (info.family === 'pdf' || extension === '.pdf') return { kind: 'pdf', inline: true, download };
  const officeMime = /^(?:application\/msword|application\/vnd\.(?:ms-|openxmlformats-officedocument\.)|application\/vnd\.oasis\.opendocument\.)/i.test(info.mime || '');
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension) || officeMime) return { kind: 'office', inline: true, download };
  if (['.txt', '.csv', '.json', '.md', '.xml', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rtf', '.yaml', '.yml'].includes(extension) || /^text\//i.test(info.mime || '') || (info.family === 'code-source' && /^text\//i.test(info.mime))) {
    return { kind: 'text', inline: true, download };
  }
  return { kind: 'unsupported', inline: false, download };
}


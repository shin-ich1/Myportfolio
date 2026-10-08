import { classifyPortfolioFile } from '../../file-type-registry.js';

const text = (value = '') => String(value ?? '').trim();

export function stageLocalMediaFile(file, options = {}) {
  if (!file) return null;
  const classified = classifyPortfolioFile(file);
  const family = text(options.family || classified.family || 'file').toLowerCase();
  const mimeType = text(file.type || classified.mimeType || '');
  const previewable = ['image', 'video', 'audio', 'pdf'].includes(family) || mimeType.startsWith('text/');
  return {
    file,
    descriptor: {
      name: file.name || '',
      originalFilename: file.name || '',
      displayName: file.name || '',
      type: mimeType,
      mimeType,
      bytes: Number(file.size || 0),
      previewUrl: previewable ? URL.createObjectURL(file) : '',
      fileFamily: family,
      pending: true
    }
  };
}

export function releaseLocalMediaSelection(selection) {
  const previewUrl = text(selection?.descriptor?.previewUrl || selection?.previewUrl);
  if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
}

export function localMediaPreviewUrl(selection) {
  return text(selection?.descriptor?.previewUrl || selection?.previewUrl);
}

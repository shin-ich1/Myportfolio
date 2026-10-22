/*
 * Canonical browser-video delivery readiness inspection.
 *
 * This checks MP4 container metadata without uploading the original or decoding frames.
 * It is a conservative compatibility gate for direct, untranscoded public delivery
 * (e.g. Google Drive). Transcoding providers retain the original and deliver a
 * browser-compatible rendition; static site media must be prepared at build time.
 *
 * Being accepted here is not proof of every device's runtime capability.
 */
const MAX_HEAD_BYTES = 512 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const AVC_PROFILES = new Set([66, 77, 100]); // Baseline, Main, High.
const MAX_AVC_LEVEL = 41; // Constrained cross-device target: H.264 Level 4.1.

function asciiAt(bytes, start, value) {
  if (start < 0 || start + value.length > bytes.length) return false;
  for (let i = 0; i < value.length; i++) if (bytes[start + i] !== value.charCodeAt(i)) return false;
  return true;
}

function findAtom(bytes, type, fileOffset = 0, size = 0) {
  for (let i = 4; i + 4 <= bytes.length; i++) {
    if (!asciiAt(bytes, i, type)) continue;
    const length = (bytes[i - 4] * 0x1000000) + (bytes[i - 3] << 16) + (bytes[i - 2] << 8) + bytes[i - 1];
    const start = fileOffset + i - 4;
    if (length < 8 || (size && start + length > size)) continue;
    return { start, length, marker: i };
  }
  return null;
}

function findAscii(bytes, value) {
  for (let i = 0; i + value.length <= bytes.length; i++) {
    if (asciiAt(bytes, i, value)) return i;
  }
  return -1;
}

function result(compatible, code, details = {}) {
  return Object.freeze({ compatible, code, ...details });
}

/**
 * Report whether an MP4 is suitable for direct public playback without a
 * provider rendition. Does not change the source file or make any network calls.
 */
export async function inspectBrowserVideoFile(file) {
  if (!file || typeof file.slice !== "function" || !(Number(file.size) > 0)) {
    return result(false, "invalid-file");
  }
  try {
    const size = Number(file.size);
    const headSize = Math.min(size, MAX_HEAD_BYTES);
    const tailStart = Math.max(0, size - MAX_TAIL_BYTES);
    const [head, tail] = await Promise.all([
      file.slice(0, headSize).arrayBuffer().then(value => new Uint8Array(value)),
      tailStart === 0
        ? file.slice(0, size).arrayBuffer().then(value => new Uint8Array(value))
        : file.slice(tailStart, size).arrayBuffer().then(value => new Uint8Array(value))
    ]);
    const ftyp = findAtom(head, "ftyp", 0, size);
    const mdat = findAtom(head, "mdat", 0, size);
    const moov = findAtom(head, "moov", 0, size) || findAtom(tail, "moov", tailStart, size);
    if (!ftyp || !mdat || !moov) return result(false, "mp4-metadata-unavailable");

    const configBytes = moov.start < headSize ? head : tail;
    const configStart = moov.start < headSize ? 0 : tailStart;
    // Only inspect the identified 'moov' portion, never arbitrary video samples.
    const offset = Math.max(0, moov.start - configStart);
    const atomBytes = configBytes.subarray(offset, Math.min(configBytes.length, offset + moov.length));
    if (atomBytes.length < moov.length) return result(false, "mp4-metadata-unavailable");

    const codecTags = ["hvc1", "hev1", "av01", "vp09", "mp4v"];
    const incompatibleCodec = codecTags.find(tag => findAscii(atomBytes, tag) !== -1);
    const avcSample = findAscii(atomBytes, "avc1") !== -1 || findAscii(atomBytes, "avc3") !== -1;
    if (!avcSample || incompatibleCodec) return result(false, "unsupported-video-codec", { codec: incompatibleCodec || "unknown" });

    const avcConfig = findAtom(atomBytes, "avcC");
    if (!avcConfig || avcConfig.marker + 8 > atomBytes.length || atomBytes[avcConfig.marker + 4] !== 1) {
      return result(false, "missing-avc-configuration");
    }
    const profile = atomBytes[avcConfig.marker + 5];
    const level = atomBytes[avcConfig.marker + 7];
    const fastStart = moov.start < mdat.start;
    const details = { codec: "h264", profile, level, fastStart };
    if (!AVC_PROFILES.has(profile) || level < 10 || level > MAX_AVC_LEVEL) {
      return result(false, "unsupported-h264-profile-level", details);
    }
    if (!fastStart) return result(false, "fast-start-required", details);
    return result(true, "compatible-h264-mp4", details);
  } catch {
    return result(false, "mp4-inspection-failed");
  }
}

export function browserVideoPreparationGuidance(report) {
  const why = String(report?.code || "mp4-inspection-failed");
  return [
    "This video cannot be confirmed as a broadly compatible direct-play MP4 (" + why + ").",
    "Prepare an H.264 Main Profile Level 4.1 or lower, yuv420p, AAC, fast-start MP4 before uploading.",
    "Your original remains unchanged."
  ].join(" ");
}

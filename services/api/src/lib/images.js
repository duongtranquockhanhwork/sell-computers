// Rules for product illustration images, shared by the upload endpoint and the
// product form validation.
const MIN_IMAGES = 1;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// The declared MIME type comes from the browser and cannot be trusted, so the
// real format is detected from the file signature ("magic bytes").
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const ALLOWED_URL = /^(\/api\/media\/\d+|\/api\/media\/gen\/[a-z]+\/\d+\/\d\.svg(\?[^\s]*)?|https:\/\/[^\s]{4,280})$/;

// Returns the cleaned list or a message describing the first problem.
function validateImageList(input) {
  if (!Array.isArray(input)) return { error: 'Images must be a list' };
  const images = [...new Set(input.map((u) => String(u).trim()).filter(Boolean))];
  if (images.length < MIN_IMAGES) return { error: `Add at least ${MIN_IMAGES} product image` };
  if (images.length > MAX_IMAGES) return { error: `A product can have at most ${MAX_IMAGES} images` };
  const bad = images.find((u) => !ALLOWED_URL.test(u));
  if (bad) return { error: 'Images must be uploaded files or https:// URLs' };
  return { images };
}

module.exports = { MIN_IMAGES, MAX_IMAGES, MAX_IMAGE_BYTES, detectImageType, validateImageList };

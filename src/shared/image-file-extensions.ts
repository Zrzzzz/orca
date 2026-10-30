export const IMAGE_FILE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
}

export const IMAGE_FILE_EXTENSIONS = Object.freeze(Object.keys(IMAGE_FILE_MIME_TYPES))

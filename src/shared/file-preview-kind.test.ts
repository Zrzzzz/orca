import { describe, expect, it } from 'vitest'
import { filePreviewForPath } from './file-preview-kind'

describe('filePreviewForPath', () => {
  it.each([
    ['a/b.MP4', { kind: 'video', mimeType: 'video/mp4' }],
    ['a\\b.opus', { kind: 'audio', mimeType: 'audio/ogg' }],
    ['x.APNG', { kind: 'image', mimeType: 'image/apng' }],
    ['x.jfif', { kind: 'image', mimeType: 'image/jpeg' }],
    ['x.jpe', { kind: 'image', mimeType: 'image/jpeg' }],
    ['x.SVG', { kind: 'image', mimeType: 'image/svg+xml' }],
    ['x.avif', { kind: 'image', mimeType: 'image/avif' }],
    ['doc.PDF', { kind: 'pdf', mimeType: 'application/pdf' }],
    ['dir/.mp4', null],
    ['lib.so', null],
    ['notes.txt', null]
  ])('%s', (path, expected) => {
    expect(filePreviewForPath(path)).toEqual(expected)
  })
})

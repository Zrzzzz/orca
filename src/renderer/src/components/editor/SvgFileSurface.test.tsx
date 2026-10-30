// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const setMode = vi.hoisted(() => vi.fn())
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ setMarkdownViewMode: setMode }) }
}))
vi.mock('./editor-lazy-views', () => ({
  ImageViewer: ({ src }: { src: string }) => <img src={src} alt="SVG preview" />
}))

import { SvgFileSurface } from './SvgFileSurface'

afterEach(() => {
  cleanup()
  setMode.mockClear()
})

it('opens source from the preview context menu and previews the updated draft on return', () => {
  const original = '<svg xmlns="http://www.w3.org/2000/svg"><text>图片 🐋</text></svg>'
  const props = {
    fileId: 'remote-owner:figure',
    filePath: '/repo/figure.svg',
    content: original,
    source: <textarea aria-label="SVG source" defaultValue={original} />,
    preferenceKey: 'remote-owner:figure',
    scrollCacheKey: 'remote-owner:figure'
  }
  const { rerender, container } = render(<SvgFileSurface {...props} mode="preview" />)
  expect(screen.queryByRole('textbox')).toBeNull()
  const image = screen.getByRole('img')
  expect(decodeURIComponent(image.getAttribute('src')!.split(',')[1])).toBe(original)
  expect(container.querySelector('svg text')).toBeNull()
  fireEvent.contextMenu(screen.getByTestId('svg-file-preview'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'View source' }))
  expect(setMode).toHaveBeenCalledWith('remote-owner:figure', 'source')
  rerender(<SvgFileSurface {...props} mode="source" />)
  expect(screen.getByRole('textbox', { name: 'SVG source' })).toHaveValue(original)
  expect(screen.queryByRole('img')).toBeNull()
  const draft = original.replace('图片', '未保存')
  rerender(<SvgFileSurface {...props} content={draft} mode="preview" />)
  expect(decodeURIComponent(screen.getByRole('img').getAttribute('src')!.split(',')[1])).toBe(draft)
})

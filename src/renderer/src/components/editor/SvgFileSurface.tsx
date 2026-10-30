import { useMemo, type ReactNode } from 'react'
import { Code } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { MarkdownViewMode } from '@/store/slices/editor'
import { ImageViewer } from './editor-lazy-views'

export function SvgFileSurface({
  fileId,
  filePath,
  content,
  mode,
  source,
  preferenceKey,
  scrollCacheKey
}: {
  fileId: string
  filePath: string
  content: string
  mode: MarkdownViewMode
  source: ReactNode
  preferenceKey: string
  scrollCacheKey: string
}) {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`,
    [content]
  )
  if (mode === 'source') {
    return source
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full min-h-0" data-testid="svg-file-preview">
          <ImageViewer
            src={src}
            byteSize={new TextEncoder().encode(content).byteLength}
            mimeType="image/svg+xml"
            filePath={filePath}
            preferenceKey={preferenceKey}
            scrollCacheKey={scrollCacheKey}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => useAppStore.getState().setMarkdownViewMode(fileId, 'source')}
        >
          <Code />
          {translate('editor.svg.viewSource', 'View source')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

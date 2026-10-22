import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CommentMarkdown from './CommentMarkdown'

function render(content: string): string {
  return renderToStaticMarkup(<CommentMarkdown variant="document" content={content} />)
}

describe('CJK strong punctuation compatibility', () => {
  it.each(['“重点”', '（重点）', '重点：', '「重点」'])('renders adjacent %s', (text) => {
    expect(render(`这是**${text}**内容`)).toContain(`这是<strong>${text}</strong>内容`)
  })

  it('handles multiple spans inside links and table cells', () => {
    expect(render('[这是**“甲”**和**“乙”**](https://example.com)')).toContain(
      '这是<strong>“甲”</strong>和<strong>“乙”</strong></a>'
    )
    expect(render('| 标题 |\n| --- |\n| 这是**“重点”**内容 |')).toContain(
      '这是<strong>“重点”</strong>内容'
    )
  })

  it.each([
    '`这是**“重点”**内容`',
    '```\n这是**“重点”**内容\n```',
    '这是\\*\\*“重点”\\*\\*内容',
    '这是&#42;&#42;“重点”&#42;&#42;内容',
    '这是** “重点” **内容',
    '这是**“未闭合',
    'word**“quoted”**word'
  ])('preserves literal or invalid input: %s', (text) => {
    expect(render(text)).not.toContain('<strong>')
  })

  it('preserves standard emphasis and nested inline formatting', () => {
    expect(render('这是**加粗**和 **重点 `code`**')).toContain(
      '这是<strong>加粗</strong>和 <strong>重点 <code'
    )
  })
})

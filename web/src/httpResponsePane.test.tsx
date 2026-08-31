import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HTTPResponsePane } from './httpCollections'

const xml = '<?xml version="1.0" encoding="UTF-8"?><Query><Property>749528</Property></Query>'
const result = { status: 200, body: xml, sent_at: '2026-08-26T08:00:00Z', headers: { 'Content-Type': 'text/xml' } }

describe('HTTPResponsePane beautify', () => {
  it('keeps beautified XML after the same last_result is cloned or curl changes', () => {
    const { rerender } = render(<HTTPResponsePane result={result} testId="http-response" empty="none" curl="curl -X POST 'http://127.0.0.1/google/search'" />)
    fireEvent.click(screen.getByTestId('http-response-beautify'))
    const pretty = document.querySelector('.http-response-body')?.textContent ?? ''
    expect(pretty).toContain('\n')
    expect(pretty).toContain('<Property>749528</Property>')

    rerender(<HTTPResponsePane result={{ ...result }} testId="http-response" empty="none" curl="curl -X POST 'http://127.0.0.1/google/search' --max-time 10" />)
    expect(document.querySelector('.http-response-body')?.textContent).toBe(pretty)
    expect(screen.getByTestId('http-response-beautify')).toBeDisabled()
  })
})

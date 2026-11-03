import { expect, test } from '@playwright/test'
import { mediaKindOf, parseTelegramLinks } from '../src/shared/telegram'

test.describe('parseTelegramLinks', () => {
  test('takes the supported message links', () => {
    const text = [
      'https://t.me/durov/12',
      't.me/c/1234567/89',
      'https://t.me/somechannel/5/77',
      'https://telegram.me/user_name/9?single',
      'https://t.me/user_name/10?comment=3'
    ].join('\n')
    expect(parseTelegramLinks(text)).toEqual([
      'https://t.me/durov/12',
      'https://t.me/c/1234567/89',
      'https://t.me/somechannel/5/77',
      'https://t.me/user_name/9',
      'https://t.me/user_name/10'
    ])
  })

  test('drops invites, bare chats and repeats', () => {
    const text =
      'https://t.me/+AbCdEf https://t.me/joinchat/xyz https://t.me/durov t.me/durov/1 https://t.me/durov/1'
    expect(parseTelegramLinks(text)).toEqual(['https://t.me/durov/1'])
  })

  test('caps at 500 links', () => {
    const text = Array.from({ length: 700 }, (_, i) => `https://t.me/channel/${i + 1}`).join(' ')
    expect(parseTelegramLinks(text)).toHaveLength(500)
  })

  test('mediaKindOf maps MIME and extension', () => {
    expect(mediaKindOf('a.bin', 'video/mp4')).toBe('video')
    expect(mediaKindOf('voice.oga')).toBe('audio')
    expect(mediaKindOf('x.jpg')).toBe('photo')
    expect(mediaKindOf('x.zip')).toBe('document')
    expect(mediaKindOf('x.tgs')).toBe('other')
  })
})

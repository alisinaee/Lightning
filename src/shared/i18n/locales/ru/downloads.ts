import type { Dict } from '../../types'

export default {
  Pause: 'Пауза',
  Resume: 'Продолжить',
  Downloads: 'Загрузки',
  '{count} downloads': {
    one: '{count} загрузка',
    few: '{count} загрузки',
    many: '{count} загрузок',
    other: '{count} загрузки'
  },
  'Remove {count} items': {
    one: 'Удалить {count} элемент',
    few: 'Удалить {count} элемента',
    many: 'Удалить {count} элементов',
    other: 'Удалить {count} элемента'
  }
} satisfies Dict

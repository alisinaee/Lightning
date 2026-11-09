import type { Dict } from '../../types'

export default {
  Telegram: 'Telegram',
  'Sign in to Telegram': 'Войти в Telegram',
  'Phone number': 'Номер телефона',
  'Verification code': 'Код подтверждения',
  'Telegram download finished': 'Загрузка из Telegram завершена',
  'Telegram download failed': 'Не удалось загрузить из Telegram',
  '1 file': '1 файл',
  '{done} of {total} files': '{done} из {total} файлов',
  'Some files could not be downloaded.': 'Некоторые файлы скачать не удалось.',
  'private chat {chat} · message {message}': 'личный чат {chat} · сообщение {message}',
  '{chat} · message {message}': '{chat} · сообщение {message}',
  'Add Telegram links': 'Добавить ссылки Telegram',
  'Paste Telegram message links to download the files in them.':
    'Вставьте ссылки на сообщения Telegram, чтобы скачать файлы из них.',
  'Paste message links, one or many. Any text works: the links are picked out of it.':
    'Вставьте одну или несколько ссылок на сообщения. Подойдёт любой текст: ссылки будут найдены в нём.',
  '{count} valid': 'Допустимых: {count}',
  '{count} ignored': 'Пропущено: {count}',
  'Already added': 'Уже добавлено',
  'Lightning Telegram folder (see Settings)': 'Папка Lightning Telegram (см. «Настройки»)',
  'Download {count} messages': {
    one: 'Скачать {count} сообщение',
    few: 'Скачать {count} сообщения',
    many: 'Скачать {count} сообщений',
    other: 'Скачать {count} сообщений'
  },
  'Messages sent between two dates': 'Сообщения между двумя датами',
  'Messages between two message numbers': 'Сообщения между двумя номерами',
  'The most recent messages': 'Самые последние сообщения',
  'Files in {chat}': 'Файлы в {chat}',
  'Pick a chat and a range of messages, then choose which files to download.':
    'Выберите чат и диапазон сообщений, затем отметьте файлы для загрузки.',
  'Step {step} of 2': 'Шаг {step} из 2',
  'Find a chat': 'Найти чат',
  'Loading your chats…': 'Загрузка чатов…',
  'No chat matches.': 'Чаты не найдены.',
  Range: 'Диапазон',
  Last: 'Последние',
  Dates: 'Даты',
  'Message numbers': 'Номера сообщений',
  'Number of messages': 'Количество сообщений',
  From: 'С',
  To: 'По',
  'Filter (optional)': 'Фильтр (необязательно)',
  'No files in that range.': 'В этом диапазоне нет файлов.',
  'Reading the chat…': 'Чтение чата…',
  'Collapse {name}': 'Свернуть {name}',
  'Expand {name}': 'Развернуть {name}',
  '{shown} of {total}': '{shown} из {total}',
  'Scan the code with Telegram on your phone: Settings → Devices → Link Desktop Device.':
    'Отсканируйте код в Telegram на телефоне: Настройки → Устройства → Подключить устройство.',
  'Two steps: your phone number first, then the code Telegram sends to your Telegram app.':
    'Два шага: сначала номер телефона, затем код, который Telegram пришлёт в ваше приложение Telegram.',
  'Reuse the account of Telegram Desktop (the telegram.org app). The Mac App Store version of Telegram cannot be imported: use the QR code instead.':
    'Использовать аккаунт Telegram Desktop (приложение с telegram.org). Версию из Mac App Store импортировать нельзя: используйте QR-код.',
  'Your phone number': 'Ваш номер телефона',
  'Start with + and the country code. Telegram will send a code to your Telegram app.':
    'Начните с + и кода страны. Telegram пришлёт код в ваше приложение Telegram.',
  'Send code': 'Отправить код',
  'The code Telegram sent you': 'Код, присланный Telegram',
  'Open the Telegram app on your phone: the code is in the chat named "Telegram" (or comes by SMS).':
    'Откройте Telegram на телефоне: код в чате «Telegram» (или придёт по SMS).',
  Verify: 'Подтвердить',
  'Your two-step password': 'Ваш пароль двухэтапной проверки',
  'Telegram cloud password': 'Облачный пароль Telegram',
  'This is the extra password you set in Telegram, not the login code.':
    'Это дополнительный пароль, заданный в Telegram, а не код входа.',
  'Start with + and the country code, like +98.': 'Начните с + и кода страны, например +7.',
  'That number looks too short.': 'Номер слишком короткий.',
  'That looks like a phone number. Enter the short code Telegram just sent you.':
    'Это похоже на номер телефона. Введите короткий код, который только что прислал Telegram.',
  'The code is digits only.': 'Код состоит только из цифр.',
  Code: 'Код',
  'Sign-in steps': 'Шаги входа',
  'That is the Telegram app itself. Pick the "Telegram Desktop" data folder, or sign in with the QR code.':
    'Это само приложение Telegram. Выберите папку данных «Telegram Desktop» или войдите по QR-коду.',
  'Sign in to Telegram so Lightning can download from your chats.':
    'Войдите в Telegram, чтобы Lightning мог скачивать из ваших чатов.',
  'Signed in as {account}': 'Вход выполнен: {account}',
  'your account': 'ваш аккаунт',
  'Signing out deletes the Telegram session Lightning stored on this computer. Files already downloaded stay.':
    'При выходе сеанс Telegram, сохранённый Lightning на этом компьютере, будет удалён. Уже скачанные файлы останутся.',
  'Keep me signed in': 'Оставаться в системе',
  'Sign out…': 'Выйти…',
  'Sign-in method': 'Способ входа',
  'Telegram Desktop data folder (optional)': 'Папка данных Telegram Desktop (необязательно)',
  'Telegram Desktop data folder': 'Папка данных Telegram Desktop',
  'Local passcode (if you set one)': 'Локальный код-пароль (если задан)',
  'Local passcode': 'Локальный код-пароль',
  'Enlarge for scanning': 'Увеличить для сканирования',
  'Telegram cannot read it? Press Stop, choose Phone number, and enter the code Telegram sends to your app.':
    'Telegram не считывает? Нажмите «Стоп», выберите «Номер телефона» и введите код, который Telegram пришлёт в приложение.',
  'Sent for the number ending in {digits}.': 'Отправлено для номера, оканчивающегося на {digits}.',
  'Asking Telegram to send you a code…': 'Запрос кода у Telegram…',
  'Checking the code with Telegram…': 'Проверка кода в Telegram…',
  'Signing in…': 'Вход…',
  'Waiting for Telegram…': 'Ожидание Telegram…',
  'Telegram downloads use the default connection. Your session is stored on this computer.':
    'Загрузки Telegram используют соединение по умолчанию. Сеанс хранится на этом компьютере.',
  Stop: 'Стоп',
  'Try again': 'Повторить',
  'Login QR code': 'QR-код для входа',
  Videos: 'Видео',
  Photos: 'Фото',
  Audio: 'Аудио',
  Documents: 'Документы',
  'Already there': 'Уже есть',
  'The download failed': 'Не удалось скачать',
  Cancelled: 'Отменено',
  'Reading the chat': 'Чтение чата',
  '{count} failed': 'С ошибкой: {count}',
  'Paused {counts}': 'Приостановлено: {counts}',
  'Downloading {counts}': 'Загружается: {counts}',
  'Move files to the Recycle Bin': 'Переместить файлы в корзину',
  'Move files to the Trash': 'Переместить файлы в Корзину',
  "Move this job's downloaded files to the Recycle Bin?":
    'Переместить скачанные файлы этой задачи в корзину?',
  "Move this job's downloaded files to the Trash?":
    'Переместить скачанные файлы этой задачи в Корзину?',
  '{count} Telegram messages': {
    one: '{count} сообщение Telegram',
    few: '{count} сообщения Telegram',
    many: '{count} сообщений Telegram',
    other: '{count} сообщений Telegram'
  }
} satisfies Dict

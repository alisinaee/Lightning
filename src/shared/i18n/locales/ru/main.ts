import type { Dict } from '../../types'

export default {
  'Quit Lightning': 'Выйти из Lightning',
  'Show Lightning': 'Показать Lightning',
  'Download complete': 'Загрузка завершена',
  'Select download folder': 'Выберите папку загрузки',
  'About {app}': 'О приложении {app}',
  'Settings…': 'Настройки…',
  'Check for Updates…': 'Проверить обновления…',
  Services: 'Службы',
  'Hide {app}': 'Скрыть {app}',
  'Hide Others': 'Скрыть остальные',
  'Show All': 'Показать все',
  'Quit {app}': 'Завершить {app}',
  'New Download…': 'Новая загрузка…',
  'Add Several Links…': 'Добавить несколько ссылок…',
  'Pause All': 'Приостановить все',
  'Resume All': 'Возобновить все',
  Quit: 'Выйти',
  Edit: 'Правка',
  Undo: 'Отменить',
  Redo: 'Повторить',
  Cut: 'Вырезать',
  Paste: 'Вставить',
  'Select All': 'Выбрать все',
  View: 'Вид',
  Reload: 'Перезагрузить',
  'Toggle Developer Tools': 'Инструменты разработчика',
  'Actual Size': 'Фактический размер',
  'Zoom In': 'Увеличить',
  'Zoom Out': 'Уменьшить',
  'Toggle Full Screen': 'Полноэкранный режим',
  Window: 'Окно',
  Minimize: 'Свернуть',
  Zoom: 'Масштаб',
  Logs: 'Журналы',
  'Download this YouTube video?': 'Скачать это видео с YouTube?',
  'Click to review the links.': 'Нажмите, чтобы просмотреть ссылки.',
  'Download this link?': 'Скачать эту ссылку?',
  'Closes by itself': 'Закроется само',
  'Closes in {seconds} s unless you use it':
    'Закроется через {seconds} с, если вы им не воспользуетесь',
  'Download {count} Telegram messages?': {
    one: 'Скачать сообщение Telegram?',
    few: 'Скачать {count} сообщения Telegram?',
    many: 'Скачать {count} сообщений Telegram?',
    other: 'Скачать {count} сообщений Telegram?'
  },
  'That download is still finishing. Try again soon.':
    'Эта загрузка ещё завершается. Повторите чуть позже.',
  'Select at least one network': 'Выберите хотя бы одну сеть',
  'Add the torrent again to start downloading.': 'Добавьте торрент заново, чтобы начать загрузку.',
  'Download added': 'Загрузка добавлена',
  '{name} is waiting for you to start it.': '{name} ждёт, пока вы её запустите.',
  'Only web downloads support replacing a link.': 'Заменить ссылку можно только у веб-загрузок.',
  'Pause the download before replacing its link.': 'Приостановите загрузку перед заменой ссылки.',
  'This download can’t resume. Start it again.':
    'Эту загрузку нельзя продолжить. Начните её заново.',
  'That isn’t a link to a file': 'Это не ссылка на файл',
  'This server doesn’t support resuming downloads. Try another link to the same file.':
    'Этот сервер не поддерживает докачку. Попробуйте другую ссылку на тот же файл.',
  'Only web downloads can be started over.': 'Заново можно начать только веб-загрузки.',
  'That link is no longer a file.': 'Эта ссылка больше не ведёт к файлу.',
  'This download has no files to choose': 'В этой загрузке нет файлов для выбора',
  'This download’s files can’t change now': 'Файлы этой загрузки сейчас нельзя изменить',
  'A file that’s already downloaded stays': 'Уже скачанный файл остаётся',
  '{name} has finished downloading.': 'Загрузка {name} завершена.',
  'Checksum does not match': 'Контрольная сумма не совпадает',
  '{name} is not the file it should be. Download it again.':
    '{name} — не тот файл, что нужен. Скачайте его заново.',
  'Use a file name, not a folder path.': 'Укажите имя файла, а не путь к папке.',
  'That name has characters a file name can’t have here.':
    'В этом имени есть символы, недопустимые в имени файла.',
  'That download is no longer in the history.': 'Этой загрузки больше нет в истории.',
  'Something in that folder already has this name.':
    'В этой папке уже есть элемент с таким именем.',
  'That is not a web address': 'Это не веб-адрес',
  'A page address starts with https://': 'Адрес страницы начинается с https://',
  'Could not open the page. Check the address and your connection.':
    'Не удалось открыть страницу. Проверьте адрес и подключение.',
  'That address is a file, not a page: add it as a link instead':
    'Этот адрес ведёт к файлу, а не к странице: добавьте его как ссылку',
  'This torrent uses BitTorrent v2 only, which Lightning doesn’t support yet':
    'Этот торрент использует только BitTorrent v2, который Lightning пока не поддерживает',
  'This isn’t a torrent Lightning can read': 'Lightning не может прочитать этот торрент',
  'Lightning supports .torrent files up to 10 MB.':
    'Lightning поддерживает файлы .torrent до 10 МБ.',
  'This magnet link isn’t valid': 'Эта magnet-ссылка недействительна',
  'Lightning needs access to your folder': 'Lightning нужен доступ к вашей папке',
  "Lightning can't save to {folder} until you allow it. Turn on Lightning under Files and Folders in System Settings.":
    'Lightning не может сохранять в {folder}, пока вы не разрешите. Включите Lightning в разделе «Файлы и папки» системных настроек.',
  'Open System Settings': 'Открыть системные настройки',
  Later: 'Позже',
  'Give the DNS a name': 'Задайте имя для DNS',
  'Enter at least one valid DNS server address':
    'Введите хотя бы один действительный адрес DNS-сервера',
  'Only links to files on the web can be tested':
    'Проверить можно только ссылки на файлы в интернете',
  'No network is connected to test with': 'Нет подключённой сети для проверки',
  'The computer will go to sleep in {seconds} seconds':
    'Компьютер перейдёт в спящий режим через {seconds} с',
  'The computer will shut down in {seconds} seconds': 'Компьютер выключится через {seconds} с',
  'Downloads are finished. Cancel to keep working.':
    'Загрузки завершены. Нажмите «Отмена», чтобы продолжить работу.',
  'All downloads have finished': 'Все загрузки завершены',
  'Do nothing': 'Ничего не делать',
  Sleep: 'Спящий режим',
  'Shut down': 'Выключить',
  '{count} downloads completed. What now?': {
    one: 'Завершена {count} загрузка. Что дальше?',
    few: 'Завершено {count} загрузки. Что дальше?',
    many: 'Завершено {count} загрузок. Что дальше?',
    other: 'Завершено {count} загрузок. Что дальше?'
  },
  '{count} downloading · ↓ {speed}': 'Загружается: {count} · ↓ {speed}',
  '{count} paused': 'На паузе: {count}'
} satisfies Dict

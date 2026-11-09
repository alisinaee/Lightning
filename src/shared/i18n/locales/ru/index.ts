import { mergeDicts } from '../merge'
import common from './common'
import main from './main'
import settings from './settings'
import downloads from './downloads'
import screens from './screens'
import telegram from './telegram'
import youtube from './youtube'
import tray from './tray'
import misc from './misc'

export default mergeDicts('ru', {
  common,
  main,
  settings,
  downloads,
  screens,
  telegram,
  youtube,
  tray,
  misc
})

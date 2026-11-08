import { BrowserWindow, nativeImage, type NativeImage } from 'electron'

let canvasWindow: BrowserWindow | null = null

function canvas(): BrowserWindow {
  if (canvasWindow && !canvasWindow.isDestroyed()) return canvasWindow
  canvasWindow = new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  void canvasWindow.loadURL('about:blank')
  return canvasWindow
}

/** The menu-bar icon with a small speed label on its left (the number over its unit), as one template image
 * the system tints for light and dark menu bars. The system's own title can only sit to the right
 * of an icon and cannot be made smaller, so the label is drawn here. */
export async function iconWithLabel(
  iconPng: Buffer,
  value: string,
  unit: string,
  /** A colour (yellow while downloading), or null for the plain icon the system tints. */
  color: string | null
): Promise<NativeImage> {
  const window = canvas()
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve) =>
      window.webContents.once('did-finish-load', () => resolve())
    )
  }
  const draw = async (): Promise<NativeImage> => {
    const script = `(async (value, unit, iconBase64, color) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + iconBase64
    await image.decode()
    const scale = 2
    const height = 18
    const iconWidth = image.naturalWidth / scale
    const iconHeight = image.naturalHeight / scale
    const surface = document.createElement('canvas')
    const context = surface.getContext('2d')
    const family = '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif'
    const valueFont = '600 9.98px ' + family
    const unitFont = '600 7.95px ' + family
    context.font = valueFont
    const valueWidth = context.measureText(value).width
    context.font = unitFont
    const textWidth = value ? Math.ceil(Math.max(valueWidth, context.measureText(unit).width)) : 0
    const gap = value ? 3 : 0
    surface.width = (textWidth + gap + iconWidth) * scale
    surface.height = height * scale
    context.scale(scale, scale)
    context.fillStyle = '#000'
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    // The number on top, its unit under it.
    if (value) {
      context.font = valueFont
      context.fillText(value, textWidth / 2, 9.5)
      context.font = unitFont
      context.fillText(unit, textWidth / 2, 17)
    }
    context.drawImage(image, textWidth + gap, (height - iconHeight) / 2, iconWidth, iconHeight)
    if (color) {
      // Everything drawn so far, in one colour.
      context.globalCompositeOperation = 'source-in'
      context.fillStyle = color
      context.fillRect(0, 0, surface.width / scale, surface.height / scale)
    }
    return surface.toDataURL('image/png').split(',')[1]
  })(${JSON.stringify(value)}, ${JSON.stringify(unit)}, ${JSON.stringify(iconPng.toString('base64'))}, ${JSON.stringify(color)})`
    const base64: string = await window.webContents.executeJavaScript(script)
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'), { scaleFactor: 2 })
    // A coloured icon must not be tinted by the system; the plain one is.
    image.setTemplateImage(color === null)
    return image
  }
  return draw()
}

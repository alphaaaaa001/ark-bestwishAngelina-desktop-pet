// CC 桌面身体 · Electron 主进程：透明 · 无边框 · 置顶
const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')

// ---------- 位置记忆：重启后她还在上次待的地方 ----------
function statePath() {
  return path.join(app.getPath('userData'), 'pet-state.json')
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch (e) {
    return {}
  }
}
function saveState(win) {
  if (!win) return
  try {
    const [x, y] = win.getPosition()
    fs.writeFileSync(statePath(), JSON.stringify({ x, y }))
  } catch (e) { /* 忽略 */ }
}
function isPosVisible(x, y) {
  // 位置不在任何显示器可视范围时，回默认位置（防止上次放到外接屏后这次找不到了）
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return x >= wa.x - 60 && x <= wa.x + wa.width - 60 && y >= wa.y - 60 && y <= wa.y + wa.height - 60
  })
}

function createWindow() {
  const saved = loadState()
  const pos = saved.x !== undefined && saved.y !== undefined && isPosVisible(saved.x, saved.y)
    ? { x: saved.x, y: saved.y }
    : { x: 120, y: 120 }

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: 234,   // 初始小尺寸（渲染端 BASE 520x460 × userScale 0.45）
    height: 207,
    transparent: true,          // 透明底：黑底 webm 会被 Chromium 自动吃掉，只留她
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,                // 等首帧渲染完再显示，避免黑屏闪烁
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false, // 失焦也不停动画
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win && win.show())

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.loadFile(path.join(__dirname, 'index.html'))

  // —— 调试：5 秒后抓一帧，确认渲染（黑底被吃/人物在） ——
  setTimeout(() => {
    if (!win || win.isDestroyed()) return
    win.webContents.capturePage().then((img) => {
      require('fs').writeFileSync(path.join(__dirname, 'capture.png'), img.toPNG())
    }).catch(() => {})
  }, 5000)

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[renderer-' + level + ']', message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer-gone]', JSON.stringify(details))
  })

  // 右键菜单：透明窗没关闭按钮，动作和退出都放这
  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '🎀 撒娇', click: () => win && win.webContents.send('pet:action', 'interact') },
      { label: '🪑 坐下', click: () => win && win.webContents.send('pet:action', 'sit') },
      { label: '😴 睡觉', click: () => win && win.webContents.send('pet:action', 'sleep') },
      { label: '☀️ 醒来', click: () => win && win.webContents.send('pet:action', 'wake') },
      { label: '💥 放大招', click: () => win && win.webContents.send('pet:action', 'skill3') },
      { type: 'separator' },
      { label: '💛 退出 CC', click: () => win && win.close() },
    ]).popup()
  })
}

// 拖动窗口：主进程轮询鼠标位置移动（坐标统一在主进程，
// 避免 DPI 下渲染进程 PointerEvent 与主进程坐标单位不一致导致"跑偏/加速"）
// 必须用 setBounds 显式带尺寸，防止 DPI 取整误差累积让窗口膨胀（游戏本 spine 版实测）
let dragTimer = null
ipcMain.on('pet:drag-start', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || dragTimer) return
  const startMouse = screen.getCursorScreenPoint()
  const [wx, wy] = win.getPosition()
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const m = screen.getCursorScreenPoint()
    const [w, h] = win.getSize()
    win.setBounds({ x: wx + m.x - startMouse.x, y: wy + m.y - startMouse.y, width: w, height: h })
  }, 16)
})
ipcMain.on('pet:drag-end', (e) => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win) saveState(win)   // 拖动结束记住位置
})

// 滚轮缩放：以窗口中心为锚点改大小（缩放时人物位置不飘）
ipcMain.on('win:set-size', (e, args) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || !Array.isArray(args)) return
  const w = Math.round(Number(args[0]))
  const h = Math.round(Number(args[1]))
  if (!Number.isFinite(w) || !Number.isFinite(h)) return
  const [cw, ch] = win.getSize()
  const [x, y] = win.getPosition()
  // setBounds 一次性带位置+尺寸，避免 DPI 取整误差让窗口越缩越大
  win.setBounds({ x: x + Math.round((cw - w) / 2), y: y + Math.round((ch - h) / 2), width: w, height: h })
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

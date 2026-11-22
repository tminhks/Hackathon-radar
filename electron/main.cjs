// Hackathon Radar — Electron main process
// Owns: backend server child process, dashboard window, system tray,
// native notifications, Start-with-Windows, single instance, port guard.

const { app, BrowserWindow, Tray, Menu, Notification, shell, dialog, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');

const PORT = 4567;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEALTH_URL = `${BASE_URL}/api/notifications`;
const PENDING_URL = `${BASE_URL}/api/notifications/pending?consumer=tray`;
const BACKEND_LABEL = 'backend'; // child server we spawned ourselves
const EXTERNAL_LABEL = 'external'; // another Radar/console app already owns the port

app.setAppUserModelId('Hackathon Radar');

const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..');
const serverEntry = path.join(serverDir, 'server.mjs');
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'radar-icon.ico')
  : path.join(__dirname, '..', 'radar-icon.ico');
const dataDir = app.getPath('userData'); // %APPDATA%\Hackathon Radar

let mainWindow = null;
let tray = null;
let serverProc = null;
let backendMode = null; // BACKEND_LABEL | EXTERNAL_LABEL
let isQuitting = false;
let pollTimer = null;
let respawnCount = 0;
let lastNotifiedId = null;

const silentStart = process.argv.includes('--background');

// ---------- single instance: second launch just opens the dashboard ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showDashboard());
}

// ---------- helpers ----------
function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode === 200, json: JSON.parse(body) });
        } catch {
          resolve({ ok: false, json: null });
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false, json: null }));
  });
}

function httpPost(url, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end('{}');
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

function logPath() {
  try {
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
    return path.join(dataDir, 'logs', 'server.log');
  } catch {
    return null;
  }
}

function migrateLegacyData() {
  // Pick up data left by the old console/Node version if it sits next to the exe.
  try {
    const exeData = path.join(path.dirname(process.execPath), 'data');
    const targetCache = path.join(dataDir, 'cache.json');
    if (fs.existsSync(targetCache) || !fs.existsSync(path.join(exeData, 'cache.json'))) return;
    fs.mkdirSync(dataDir, { recursive: true });
    for (const name of ['cache.json', 'user_state.json']) {
      const src = path.join(exeData, name);
      const dst = path.join(dataDir, name);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch {}
}

// ---------- backend server ----------
function spawnServer() {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    RADAR_DATA_DIR: dataDir,
    RADAR_EMBEDDED: '1',
    PORT: String(PORT),
  };
  const log = logPath();
  const out = log ? fs.openSync(log, 'a') : 'ignore';
  serverProc = spawn(process.execPath, [serverEntry], {
    env,
    cwd: serverDir,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  serverProc.on('exit', (code) => {
    serverProc = null;
    if (isQuitting || backendMode !== BACKEND_LABEL) return;
    if (respawnCount < 3) {
      respawnCount += 1;
      setTimeout(startBackend, 1500);
    } else {
      dialog.showErrorBox(
        'Hackathon Radar',
        'Máy chủ Radar dừng đột ngột. Hãy mở lại app. Nếu lỗi lặp lại, xem log tại:\n' +
          (log || '(không ghi được log)')
      );
      app.quit();
    }
  });
}

async function waitForServer(maxMs = 20000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await httpGetJson(HEALTH_URL, 1500);
    if (r.ok) return true;
    if (!serverProc) return false; // died already
    await new Promise((r2) => setTimeout(r2, 400));
  }
  return false;
}

async function startBackend() {
  if (await isPortFree(PORT)) {
    backendMode = BACKEND_LABEL;
    spawnServer();
    const ok = await waitForServer();
    if (!ok && backendMode === BACKEND_LABEL) return; // respawn logic handles it
    return;
  }

  // Port busy — figure out who owns it.
  const probe = await httpGetJson(`${BASE_URL}/api/hackathons`, 1500);
  const looksLikeRadar = probe.ok && probe.json && Array.isArray(probe.json.hackathons);

  if (looksLikeRadar) {
    backendMode = EXTERNAL_LABEL;
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: 'Hackathon Radar',
      message: 'Cổng 4567 đang được một phiên bản Radar khác sử dụng.',
      detail:
        'Có thể bản console cũ của Radar vẫn đang chạy ngầm.\n' +
        'Bạn có thể mở dashboard dùng chung backend đó, hoặc tắt app kia rồi mở lại bản này.',
      buttons: ['Mở dashboard', 'Thoát'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) {
      app.quit();
      return;
    }
    return; // window will attach to the external backend
  }

  await dialog.showMessageBox({
    type: 'error',
    title: 'Hackathon Radar',
    message: 'Không mở được cổng 4567.',
    detail:
      'Một ứng dụng khác đang chiếm cổng này. Hãy tắt app đó (nếu là bản Radar console cũ, đóng cửa sổ đen của nó) rồi chạy lại HackathonRadar.exe.',
    buttons: ['Đóng'],
  });
  app.quit();
}

// ---------- window ----------
function createWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1024,
    minHeight: 660,
    title: 'Hackathon Radar',
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // External links (Register, Official Page, Google AI Studio…) → system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(BASE_URL)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide(); // keep scanning in tray
    }
  });
  mainWindow.on('closed', () => (mainWindow = null));

  mainWindow.loadURL(BASE_URL);
}

function showDashboard() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- tray ----------
function loginItemEnabled() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => showDashboard() },
    { type: 'separator' },
    {
      label: 'Refresh Now',
      click: async () => {
        const ok = await httpPost(`${BASE_URL}/api/refresh`, 120000);
        if (!ok) {
          new Notification({
            title: 'Hackathon Radar',
            body: 'Không quét được — backend chưa sẵn sàng.',
          }).show();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: loginItemEnabled(),
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          args: ['--background'],
        });
        item.checked = loginItemEnabled();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Hackathon Radar');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => showDashboard());
}

// ---------- native notifications ----------
function startNotificationPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const r = await httpGetJson(PENDING_URL, 2500);
    if (!r.ok || !r.json) return;
    if (typeof r.json.liveCount === 'number' && tray) {
      tray.setToolTip(`Hackathon Radar — ${r.json.liveCount} giải đang mở`);
    }
    const items = Array.isArray(r.json.items) ? r.json.items : [];
    for (const item of items.slice(0, 3)) {
      if (!item || item.id === lastNotifiedId) continue;
      lastNotifiedId = item.id;
      const n = new Notification({
        title: String(item.title || 'Hackathon Radar').slice(0, 90),
        body: String(item.message || '').slice(0, 250),
        icon: nativeImage.createFromPath(iconPath),
      });
      n.on('click', () => {
        const url = String(item.url || '');
        if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
          showDashboard();
        } else if (/^https?:\/\//i.test(url)) {
          shell.openExternal(url);
        } else {
          showDashboard();
        }
      });
      n.show();
    }
  }, 3000);
}

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  migrateLegacyData();
  createTray();
  await startBackend();
  if (isQuitting) return;
  startNotificationPolling();
  if (!silentStart) showDashboard();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {}
  }
});

// Keep the app alive in the tray even with no windows.
app.on('window-all-closed', () => {});

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanAllGlobalHackathons, computeCompetitionAndScore, classifyCategories } from './src/scrapers.mjs';
import { listGeminiModels, chatWithRadarAI, CURRENT_GEMINI_MODELS } from './src/gemini_chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = process.env.RADAR_PUBLIC_DIR || path.join(__dirname, 'public');
const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const STATE_FILE = path.join(DATA_DIR, 'user_state.json');

const PORT = Number(process.env.PORT) || 4567;
const AUTO_SCAN_INTERVAL_MS = 15 * 60 * 1000; // Scan global sources every 15 minutes
const SCAN_TIMEOUT_MS = 150 * 1000; // Hard watchdog: a stuck scan must never leave the radar blind

await fs.mkdir(DATA_DIR, { recursive: true });

let cache = {
  scannedAt: null,
  durationMs: 0,
  sourceStats: [],
  hackathons: []
};

const DEFAULT_NOTIFY_SETTINGS = {
  enabled: true,
  cadenceMinutes: 3, // High-frequency notifications by default ("hiện thông báo nhiều")
  types: {
    newEvents: true,
    hiddenGems: true,
    urgentDeadlines: true,
    vietnamAndGrants: true,
    scanPulse: true
  }
};

let userState = {
  items: {},
  customHackathons: [],
  seenIds: [],
  newIds: [],
  notifySettings: { ...DEFAULT_NOTIFY_SETTINGS },
  notificationLog: [],
  notifiedRotationIds: []
};

let pendingTrayQueue = [];
let lastTrayPollAt = 0;
let unreadCount = 0;
let isScanning = false;
let proactiveTimer = null;

// Scan health — the "radar went silently blind" fix. Exposed via /api/hackathons.
let scanHealth = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastAttemptStats: null
};

function withTimeout(promise, ms, message) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function loadDiskData() {
  try {
    const rawCache = await fs.readFile(CACHE_FILE, 'utf8');
    cache = JSON.parse(rawCache);
  } catch {}
  try {
    const rawState = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(rawState);
    userState = {
      ...userState,
      ...parsed,
      notifySettings: {
        ...DEFAULT_NOTIFY_SETTINGS,
        ...(parsed.notifySettings || {}),
        types: {
          ...DEFAULT_NOTIFY_SETTINGS.types,
          ...(parsed.notifySettings?.types || {})
        }
      }
    };
  } catch {}
}

async function saveCache() {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function saveState() {
  await fs.writeFile(STATE_FILE, JSON.stringify(userState, null, 2), 'utf8');
}

/**
 * Fallback native Windows 10/11 Toast popup when Tray .exe is not polling
 */
function fireDirectWindowsToast(title, message) {
  if (process.platform !== 'win32') return;
  if (process.env.RADAR_EMBEDDED === '1') return; // Electron main process owns native notifications
  const safeTitle = String(title).replace(/'/g, "''").slice(0, 90);
  const safeMsg = String(message).replace(/'/g, "''").slice(0, 200);
  const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $template = "<toast><visual><binding template='ToastGeneric'><text>$('${safeTitle}')</text><text>$('${safeMsg}')</text></binding></visual></toast>"
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.Explorer').Show($toast)
  `;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch {}
}

function pushNotification({ title, message, url = 'http://127.0.0.1:4567', tag = 'gem' }) {
  const entry = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    message,
    url,
    tag,
    createdAt: new Date().toISOString()
  };

  userState.notificationLog = [entry, ...(userState.notificationLog || [])].slice(0, 40);
  unreadCount = Math.min(99, unreadCount + 1);
  pendingTrayQueue.push(entry);
  if (pendingTrayQueue.length > 25) pendingTrayQueue.shift();

  // If Tray .exe hasn't polled in the last 10s, fire direct Windows WinRT Toast so user still sees native OS popups!
  if (Date.now() - lastTrayPollAt > 10000) {
    fireDirectWindowsToast(title, message);
  }

  saveState().catch(() => {});
  return entry;
}

function getAllActiveHackathons() {
  const all = [...(userState.customHackathons || []), ...(cache.hackathons || [])];
  const now = Date.now();
  return all.filter((h) => {
    const st = userState.items?.[h.id]?.status || 'none';
    if (st === 'hidden') return false;
    if (h.blocked) return false;
    if (h.deadline && new Date(h.deadline).getTime() < now) return false;
    return true;
  });
}

/**
 * Picks an interesting, rotated hackathon notification so the user receives rich, frequent alerts
 */
function dispatchSmartProactiveAlert(force = false) {
  const cfg = userState.notifySettings || DEFAULT_NOTIFY_SETTINGS;
  if (!force && !cfg.enabled) return null;

  const list = getAllActiveHackathons();
  if (!list.length) return null;

  const rotated = new Set(userState.notifiedRotationIds || []);
  const now = Date.now();

  const candidates = [];

  // 1. Urgent Deadlines (< 48h left on Saved/Registered OR >= $10,000 prize)
  if (cfg.types?.urgentDeadlines || force) {
    for (const h of list) {
      if (!h.deadline) continue;
      const hoursLeft = (new Date(h.deadline).getTime() - now) / 3600000;
      const st = userState.items?.[h.id]?.status || 'none';
      const isTracked = ['saved', 'registered', 'building'].includes(st);
      if (hoursLeft > 0 && hoursLeft <= 48 && (isTracked || h.prizeUsd >= 10000)) {
        candidates.push({
          key: `urgent-${h.id}`,
          priority: isTracked ? 100 : 88,
          title: `⏳ Sắp đóng đơn (còn ${Math.max(1, Math.round(hoursLeft))}h)!`,
          message: `${h.title} (${h.prizeDisplay} · ${h.platform}) sắp hết hạn đăng ký.`,
          url: h.url,
          tag: 'urgent'
        });
      }
    }
  }

  // 2. Vietnam & Travel Grants
  if (cfg.types?.vietnamAndGrants || force) {
    for (const h of list) {
      if (h.isVietnam || h.hasTravelGrant) {
        candidates.push({
          key: `vn-${h.id}`,
          priority: h.isVietnam ? 92 : 84,
          title: h.isVietnam ? `🇻🇳 Hackathon tại Việt Nam` : `✈️ Hackathon hỗ trợ Travel Grant`,
          message: `${h.title} — ${h.prizeDisplay} (${h.location})`,
          url: h.url,
          tag: 'vietnam'
        });
      }
    }
  }

  // 3. Hidden Gems (High Prize, Low Competition)
  if (cfg.types?.hiddenGems || force) {
    for (const h of list) {
      if (h.isHiddenGem) {
        const regStr = h.registrationsCount !== null ? `chỉ ${h.registrationsCount} người ĐK` : 'ít cạnh tranh';
        candidates.push({
          key: `gem-${h.id}`,
          priority: 90,
          title: `💎 Kèo Thơm Dễ Thắng (${h.prizeDisplay})`,
          message: `${h.title} trên ${h.platform} — hiện mới ${regStr}!`,
          url: h.url,
          tag: 'gem'
        });
      }
    }
  }

  // 4. High-Prize Global Challenges ($25k+)
  for (const h of list.slice(0, 25)) {
    if (h.prizeUsd >= 25000) {
      candidates.push({
        key: `mega-${h.id}`,
        priority: 75,
        title: `🏆 Giải thưởng lớn: ${h.prizeDisplay}`,
        message: `${h.title} (${h.platform} · ${h.location}) đang mở đăng ký.`,
        url: h.url,
        tag: 'mega'
      });
    }
  }

  if (!candidates.length) return null;

  // Prefer un-notified candidates first; reset rotation when exhausted
  let pool = candidates.filter((c) => !rotated.has(c.key));
  if (!pool.length) {
    userState.notifiedRotationIds = [];
    rotated.clear();
    pool = candidates;
  }

  pool.sort((a, b) => b.priority - a.priority);
  const topSlice = pool.slice(0, Math.min(6, pool.length));
  const chosen = topSlice[Math.floor(Math.random() * topSlice.length)];

  rotated.add(chosen.key);
  userState.notifiedRotationIds = [...rotated].slice(-120);

  return pushNotification(chosen);
}

function restartProactiveSchedule() {
  if (proactiveTimer) clearInterval(proactiveTimer);
  const mins = Math.max(1, Number(userState.notifySettings?.cadenceMinutes) || 3);
  proactiveTimer = setInterval(() => {
    dispatchSmartProactiveAlert(false);
  }, mins * 60 * 1000);
}

async function performScan() {
  if (isScanning) return cache;
  isScanning = true;
  scanHealth.lastAttemptAt = new Date().toISOString();
  try {
    console.log(`[Radar] Đang quét các sàn Hackathon toàn cầu...`);
    const result = await withTimeout(
      scanAllGlobalHackathons(),
      SCAN_TIMEOUT_MS,
      `Quét vượt quá ${Math.round(SCAN_TIMEOUT_MS / 1000)}s — bị treo`
    );
    scanHealth.lastAttemptStats = result.sourceStats;

    // A source that errors OR returns 0 items is suspicious — preserve its
    // previously-cached items so the radar never silently loses a platform.
    const failedNames = new Set();
    for (const s of result.sourceStats) {
      if (!s.ok || s.count === 0) {
        failedNames.add(s.name);
        if (s.ok) {
          s.ok = false;
          s.error = 'Nguồn trả về 0 kết quả (nghi lỗi)';
        }
        s.preserved = true;
        console.warn(`[Radar] ⚠ Nguồn ${s.name} lỗi: ${s.error || 'không rõ'}`);
      }
    }
    if (failedNames.size > 0 && cache.hackathons?.length) {
      const newIds = new Set(result.hackathons.map((h) => h.id));
      let preserved = 0;
      for (const h of cache.hackathons) {
        if (failedNames.has(h.platform) && !newIds.has(h.id)) {
          result.hackathons.push(h);
          preserved++;
        }
      }
      if (preserved > 0) {
        console.log(`[Radar] Giữ lại ${preserved} giải từ nguồn đang lỗi: ${[...failedNames].join(', ')}`);
      }
    }

    if (!result.hackathons.length) {
      throw new Error('Quét trả về 0 giải — toàn bộ nguồn lỗi hoặc mạng bị chặn');
    }

    const prevSeen = new Set(userState.seenIds || []);
    const freshNewItems = [];
    for (const h of result.hackathons) {
      if (prevSeen.size > 0 && !prevSeen.has(h.id)) {
        freshNewItems.push(h);
      }
      prevSeen.add(h.id);
    }
    userState.seenIds = [...prevSeen].slice(-3000);
    if (freshNewItems.length > 0) {
      userState.newIds = [...new Set([...freshNewItems.map((x) => x.id), ...(userState.newIds || [])])].slice(0, 100);
    }
    cache = result;
    await saveCache();
    await saveState();
    scanHealth.lastSuccessAt = result.scannedAt;
    scanHealth.consecutiveFailures = 0;
    scanHealth.lastError = failedNames.size ? `Nguồn lỗi: ${[...failedNames].join(', ')}` : null;
    console.log(`[Radar] Hoàn tất trong ${result.durationMs}ms — Tìm thấy ${result.hackathons.length} giải đang mở!`);

    const cfg = userState.notifySettings || DEFAULT_NOTIFY_SETTINGS;
    if (cfg.enabled) {
      if (freshNewItems.length > 0 && cfg.types?.newEvents) {
        const topNew = freshNewItems[0];
        pushNotification({
          title: `🆕 Phát hiện ${freshNewItems.length} giải Hackathon mới!`,
          message: `Nổi bật: ${topNew.title} (${topNew.prizeDisplay} · ${topNew.platform})`,
          url: topNew.url,
          tag: 'new'
        });
      } else if (cfg.types?.scanPulse) {
        const totalPrize = result.hackathons.reduce((s, h) => s + (h.prizeUsd || 0), 0);
        pushNotification({
          title: `📡 Radar đã quét mới ${result.hackathons.length} giải toàn cầu`,
          message: `Tổng quỹ thưởng $${(totalPrize / 1_000_000).toFixed(2)}M từ 7 nguồn toàn cầu — Bấm để xem Kèo Thơm!`,
          url: 'http://127.0.0.1:4567',
          tag: 'pulse'
        });
      }
    }
    return cache;
  } catch (err) {
    scanHealth.consecutiveFailures++;
    scanHealth.lastError = err.message || 'Lỗi không rõ';
    console.error(
      `[Radar] ❌ Quét thất bại (lần liên tiếp ${scanHealth.consecutiveFailures}): ${scanHealth.lastError} — giữ nguyên ${cache.hackathons?.length || 0} giải từ cache cũ.`
    );
    if (scanHealth.consecutiveFailures === 1) {
      pushNotification({
        title: '⚠️ Radar quét thất bại',
        message: `${scanHealth.lastError} — vẫn hiển thị ${cache.hackathons?.length || 0} giải từ lần quét trước.`,
        url: 'http://127.0.0.1:4567',
        tag: 'error'
      });
    }
    return cache;
  } finally {
    isScanning = false;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

await loadDiskData();
restartProactiveSchedule();

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // API: Get all hackathons & state
    if (req.method === 'GET' && pathname === '/api/hackathons') {
      return sendJson(res, 200, {
        ...cache,
        sourceStats: scanHealth.lastAttemptStats || cache.sourceStats || [],
        scanHealth,
        customHackathons: userState.customHackathons || [],
        itemStates: userState.items || {},
        newIds: userState.newIds || [],
        blockedCount: (cache.hackathons || []).filter((h) => h.blocked).length,
        notifySettings: userState.notifySettings || DEFAULT_NOTIFY_SETTINGS,
        unreadCount,
        isScanning
      });
    }

    // API: Get notification history & settings
    if (req.method === 'GET' && pathname === '/api/notifications') {
      return sendJson(res, 200, {
        settings: userState.notifySettings || DEFAULT_NOTIFY_SETTINGS,
        log: userState.notificationLog || [],
        unreadCount,
        trayConnected: Date.now() - lastTrayPollAt < 10000
      });
    }

    // API: Native Windows Tray App polls pending desktop popups here
    if (req.method === 'GET' && pathname === '/api/notifications/pending') {
      if (urlObj.searchParams.get('consumer') === 'tray') {
        lastTrayPollAt = Date.now();
      }
      const items = pendingTrayQueue.splice(0, pendingTrayQueue.length);
      return sendJson(res, 200, {
        items,
        liveCount: (cache.hackathons?.length || 0) + (userState.customHackathons?.length || 0),
        cadenceMinutes: userState.notifySettings?.cadenceMinutes || 3
      });
    }

    // API: Mark notifications read
    if (req.method === 'POST' && pathname === '/api/notifications/read') {
      unreadCount = 0;
      return sendJson(res, 200, { ok: true, unreadCount: 0 });
    }

    // API: Get Gemini AI Copilot config
    if (req.method === 'GET' && pathname === '/api/ai/config') {
      const effectiveKey = userState.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      const activeModel =
        userState.geminiModel && !/^gemini-(1\.5|2\.0|2\.5)/i.test(userState.geminiModel)
          ? userState.geminiModel
          : 'gemini-4-hydrogen';
      return sendJson(res, 200, {
        hasKey: Boolean(effectiveKey),
        keyPreview: effectiveKey ? `${effectiveKey.slice(0, 6)}••••${effectiveKey.slice(-4)}` : '',
        model: activeModel,
        models: CURRENT_GEMINI_MODELS
      });
    }

    // API: Save & validate Gemini API Key / selected model
    if (req.method === 'POST' && pathname === '/api/ai/config') {
      const body = await readJsonBody(req);
      if (body.clearKey) {
        userState.geminiApiKey = '';
        await saveState();
        return sendJson(res, 200, { ok: true, hasKey: false });
      }
      if (body.apiKey !== undefined && String(body.apiKey).trim()) {
        const cleanKey = String(body.apiKey).trim();
        const verified = await listGeminiModels(cleanKey);
        userState.geminiApiKey = cleanKey;
        userState.cachedModels = verified.models;
        userState.geminiModel = body.model || verified.preferredModel;
      } else if (body.model) {
        userState.geminiModel = String(body.model);
      }
      await saveState();
      const effectiveKey = userState.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      return sendJson(res, 200, {
        ok: true,
        hasKey: Boolean(effectiveKey),
        keyPreview: effectiveKey ? `${effectiveKey.slice(0, 6)}••••${effectiveKey.slice(-4)}` : '',
        model: userState.geminiModel || 'gemini-4-hydrogen',
        models: CURRENT_GEMINI_MODELS
      });
    }

    // API: Chat with Gemini Radar AI Copilot (v1/interactions)
    if (req.method === 'POST' && pathname === '/api/ai/chat') {
      const body = await readJsonBody(req);
      const effectiveKey = userState.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      if (!effectiveKey) {
        return sendJson(res, 400, { error: 'Chưa cài đặt Gemini API Key. Hãy dán API Key ở góc trên khung chat.' });
      }
      const all = [...(userState.customHackathons || []), ...(cache.hackathons || [])];
      const focusedHackathon = body.focusedId ? all.find((x) => x.id === body.focusedId) || null : null;
      const result = await chatWithRadarAI({
        apiKey: effectiveKey,
        model: body.model || userState.geminiModel || 'gemini-4-hydrogen',
        messages: body.messages || [],
        previousInteractionId: body.previousInteractionId || null,
        focusedHackathon,
        allHackathons: all,
        itemStates: userState.items || {}
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    // API: Update notification settings & frequency
    if (req.method === 'POST' && pathname === '/api/notify-settings') {
      const body = await readJsonBody(req);
      userState.notifySettings = {
        ...DEFAULT_NOTIFY_SETTINGS,
        ...(userState.notifySettings || {}),
        ...body,
        types: {
          ...DEFAULT_NOTIFY_SETTINGS.types,
          ...(userState.notifySettings?.types || {}),
          ...(body.types || {})
        }
      };
      restartProactiveSchedule();
      await saveState();
      return sendJson(res, 200, { ok: true, settings: userState.notifySettings });
    }

    // API: Fire an immediate test / gem notification
    if (req.method === 'POST' && pathname === '/api/notify/test') {
      const entry =
        dispatchSmartProactiveAlert(true) ||
        pushNotification({
          title: '📡 Hackathon Radar Desktop Alert',
          message: 'Thông báo máy tính đã hoạt động! Hệ thống sẽ tự động báo giải mới & Kèo Thơm cho bạn.',
          url: 'http://127.0.0.1:4567',
          tag: 'test'
        });
      return sendJson(res, 200, { ok: true, notification: entry, log: userState.notificationLog, unreadCount });
    }

    // API: Trigger live scan
    if (req.method === 'POST' && pathname === '/api/refresh') {
      await performScan();
      return sendJson(res, 200, {
        ...cache,
        sourceStats: scanHealth.lastAttemptStats || cache.sourceStats || [],
        scanHealth,
        customHackathons: userState.customHackathons || [],
        itemStates: userState.items || {},
        newIds: userState.newIds || [],
        blockedCount: (cache.hackathons || []).filter((h) => h.blocked).length,
        unreadCount,
        isScanning
      });
    }

    // API: Update bookmark / registration status / note
    if (req.method === 'POST' && pathname === '/api/item-state') {
      const body = await readJsonBody(req);
      const { id, status, note } = body;
      if (!id) return sendJson(res, 400, { error: 'Missing hackathon id' });

      const current = userState.items[id] || { status: 'none', note: '' };
      if (status !== undefined) current.status = status;
      if (note !== undefined) current.note = String(note).slice(0, 1000);
      current.updatedAt = new Date().toISOString();

      if (current.status === 'none' && !current.note) {
        delete userState.items[id];
      } else {
        userState.items[id] = current;
      }
      await saveState();
      return sendJson(res, 200, { ok: true, itemStates: userState.items });
    }

    // API: Add custom hackathon
    if (req.method === 'POST' && pathname === '/api/custom-hackathon') {
      const body = await readJsonBody(req);
      if (!body.title || !body.url) {
        return sendJson(res, 400, { error: 'Vui lòng nhập Tên giải và Link đăng ký' });
      }
      const prizeUsd = Math.max(0, Number(body.prizeUsd) || 0);
      const customItem = {
        id: `custom-${Date.now()}`,
        platform: body.platform || 'Tự thêm',
        title: String(body.title).trim(),
        organizer: String(body.organizer || 'Ban tổ chức').trim(),
        url: String(body.url).trim(),
        thumbnail: null,
        status: 'open',
        startDate: new Date().toISOString(),
        deadline: body.deadline ? new Date(body.deadline).toISOString() : null,
        dateText: '',
        prizeUsd,
        prizeDisplay: prizeUsd > 0 ? `$${prizeUsd.toLocaleString('en-US')}` : (body.prizeDisplay || 'Xem chi tiết'),
        registrationsCount: body.registrationsCount ? Number(body.registrationsCount) : null,
        mode: body.mode || 'vietnam',
        isVietnam: body.mode === 'vietnam',
        hasTravelGrant: Boolean(body.hasTravelGrant),
        location: body.location || (body.mode === 'vietnam' ? 'Việt Nam' : body.mode === 'online' ? 'Online Toàn Cầu' : 'Quốc tế'),
        teamSize: body.teamSize || null,
        tags: ['Giải tự thêm', ...(body.tags || [])],
        categories: body.categories?.length ? body.categories : classifyCategories([body.title, body.summary || '']),
        summary: String(body.summary || 'Giải Hackathon được bạn thêm thủ công vào Radar theo dõi.').trim()
      };
      const computed = { ...customItem, ...computeCompetitionAndScore(customItem) };
      userState.customHackathons = [computed, ...(userState.customHackathons || [])];
      userState.items[computed.id] = { status: 'saved', note: '', updatedAt: new Date().toISOString() };
      await saveState();
      return sendJson(res, 200, { ok: true, customHackathons: userState.customHackathons, itemStates: userState.items });
    }

    // API: Delete custom hackathon
    if (req.method === 'DELETE' && pathname.startsWith('/api/custom-hackathon/')) {
      const id = decodeURIComponent(pathname.replace('/api/custom-hackathon/', ''));
      userState.customHackathons = (userState.customHackathons || []).filter((h) => h.id !== id);
      delete userState.items[id];
      await saveState();
      return sendJson(res, 200, { ok: true, customHackathons: userState.customHackathons });
    }

    // Static files
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    try {
      const content = await fs.readFile(safePath);
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.once('error', (err) => {
  console.error(`[Radar] Không thể mở cổng ${PORT}: ${err.code || err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 GLOBAL HACKATHON RADAR đang chạy tại: http://localhost:${PORT}`);
  const ageMs = cache.scannedAt ? Date.now() - new Date(cache.scannedAt).getTime() : Infinity;
  if (!cache.hackathons?.length || ageMs > 15 * 60 * 1000) {
    performScan();
  } else {
    // Queue an initial gem spotlight notification shortly after boot
    setTimeout(() => dispatchSmartProactiveAlert(false), 6000);
  }
  setInterval(() => {
    performScan();
  }, AUTO_SCAN_INTERVAL_MS);
});

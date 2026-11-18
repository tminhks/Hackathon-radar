const state = {
  hackathons: [],
  customHackathons: [],
  itemStates: {},
  newIds: new Set(),
  sourceStats: [],
  scannedAt: null,
  theme: localStorage.getItem('radar_theme') || 'dark',
  activeTab: 'all', // all | gems | vn_travel | saved | hidden
  category: 'all',
  search: '',
  mode: 'all',
  minPrize: 0,
  deadlineDays: 'all',
  comp: 'all',
  platform: 'all',
  onlyTravelGrant: false,
  sort: 'score',
  heroIdx: 0,
  editingId: null,
  editingStatus: 'none'
};

const SAVE_BUTTON_TEXT = {
  none: 'Save',
  saved: 'Saved',
  registered: 'Registered',
  building: 'Building',
  hidden: 'Hidden'
};

function applyTheme(mode) {
  state.theme = mode === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('radar_theme', state.theme);
  document.querySelectorAll('.theme-opt').forEach((el) => {
    el.classList.toggle('active', el.dataset.mode === state.theme);
  });
}
applyTheme(state.theme);

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAllCombined() {
  return [...(state.customHackathons || []), ...(state.hackathons || [])];
}

function formatHeroCountdown(deadlineIso, fallback = '') {
  if (!deadlineIso) return fallback || 'Open Registration';
  const diff = new Date(deadlineIso).getTime() - Date.now();
  if (diff <= 0) return 'Closing soon';
  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(d).padStart(2, '0')}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m remaining`;
}

function formatShortCountdown(deadlineIso, fallback = '', status = 'open') {
  if (!deadlineIso) {
    if (status === 'upcoming') return { text: 'Upcoming', urgent: false };
    return { text: fallback ? fallback.replace('about ', '') : 'Open', urgent: false };
  }
  const diff = new Date(deadlineIso).getTime() - Date.now();
  if (diff <= 0) return { text: 'Closing', urgent: true };
  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d >= 1) {
    return { text: `${d}d ${h}h left`, urgent: d < 3 };
  }
  return { text: `${h}h ${m}m left`, urgent: true };
}

function formatPrizeHeadline(item) {
  if (item.prizeUsd > 0) {
    return `$${item.prizeUsd.toLocaleString('en-US')}`;
  }
  if (/ETHGlobal/i.test(item.platform)) return '$100,000+';
  return 'Prizes & Grants';
}

function getCompetitionBar(regs) {
  if (regs === null || regs === undefined) {
    return { dot: 'dot-unknown', fill: 'fill-unknown', pct: 22, label: 'Open Entry' };
  }
  if (regs < 150) {
    return {
      dot: 'dot-low',
      fill: 'fill-low',
      pct: Math.max(10, Math.round((regs / 150) * 34)),
      label: 'Low Competition'
    };
  }
  if (regs <= 800) {
    return {
      dot: 'dot-medium',
      fill: 'fill-medium',
      pct: Math.min(72, 34 + Math.round(((regs - 150) / 650) * 38)),
      label: 'Moderate'
    };
  }
  return {
    dot: 'dot-high',
    fill: 'fill-high',
    pct: Math.min(100, 74 + Math.round(Math.min(regs - 800, 4000) / 160)),
    label: 'High Demand'
  };
}

function formatLocationShort(item) {
  if (item.isVietnam) {
    if (/hanoi|hà nội/i.test(item.location + ' ' + item.title)) return 'Hanoi, Vietnam';
    if (/ho chi minh|saigon|hcmc/i.test(item.location + ' ' + item.title)) return 'Ho Chi Minh City';
    return 'Vietnam';
  }
  if (item.mode === 'online') return 'Online';
  return item.location || 'International';
}

function formatCardSubtitle(item) {
  const parts = [formatLocationShort(item)];
  if (item.hasTravelGrant && item.mode !== 'online') {
    parts.push('Travel Grant');
  }
  if (typeof item.registrationsCount === 'number') {
    parts.push(`${item.registrationsCount.toLocaleString('en-US')} registered`);
  } else if (item.teamSize) {
    parts.push(`Team ${item.teamSize.replace(' người', '')}`);
  }
  return parts.join(' · ');
}

function getSpotlights() {
  const visible = getAllCombined().filter((h) => (state.itemStates[h.id]?.status || 'none') !== 'hidden');
  const sorted = [...visible].sort((a, b) => (b.prizeUsd || 0) - (a.prizeUsd || 0));
  return sorted.slice(0, 5);
}

function renderHero() {
  const spots = getSpotlights();
  if (!spots.length) return;
  if (state.heroIdx >= spots.length) state.heroIdx = 0;
  if (state.heroIdx < 0) state.heroIdx = spots.length - 1;

  const h = spots[state.heroIdx];
  const st = state.itemStates[h.id]?.status || 'none';
  const comp = getCompetitionBar(h.registrationsCount);

  document.getElementById('heroEyebrow').textContent = `FEATURED GLOBAL CHALLENGE · ${h.platform.toUpperCase()}`;
  document.getElementById('heroIndexText').textContent = `${state.heroIdx + 1} / ${spots.length}`;
  document.getElementById('heroTitle').textContent = h.title;

  const prizePart = h.prizeUsd > 0 ? `$${h.prizeUsd.toLocaleString('en-US')} Prize Pool` : h.prizeDisplay;
  const cdPart = formatHeroCountdown(h.deadline, h.dateText);
  const thirdPart = h.hasTravelGrant ? 'Travel Grant' : comp.label;

  const metaEl = document.getElementById('heroMeta');
  metaEl.textContent = `${prizePart} · ${cdPart} · ${thirdPart}`;
  metaEl.setAttribute('data-hero-deadline', h.deadline || '');
  metaEl.setAttribute('data-hero-prize', prizePart);
  metaEl.setAttribute('data-hero-third', thirdPart);

  const regBtn = document.getElementById('heroRegisterBtn');
  regBtn.href = h.url;

  const saveBtn = document.getElementById('heroSaveBtn');
  saveBtn.textContent = SAVE_BUTTON_TEXT[st] || 'Save';
  saveBtn.dataset.id = h.id;

  document.getElementById('heroNotesBtn').dataset.id = h.id;
  document.getElementById('heroAskAiBtn').dataset.id = h.id;
}

function filterAndSortItems() {
  const now = Date.now();
  const q = state.search.trim().toLowerCase();

  const list = getAllCombined().filter((h) => {
    const userSt = state.itemStates[h.id]?.status || 'none';

    if (state.activeTab === 'hidden') return userSt === 'hidden';
    if (userSt === 'hidden') return false;

    if (state.activeTab === 'gems' && !h.isHiddenGem) return false;
    if (state.activeTab === 'vn_travel' && !(h.isVietnam || h.hasTravelGrant)) return false;
    if (state.activeTab === 'saved' && !['saved', 'registered', 'building'].includes(userSt)) return false;

    if (h.deadline && new Date(h.deadline).getTime() < now - 6 * 3600 * 1000) return false;

    if (q) {
      const hay = `${h.title} ${h.organizer} ${h.location} ${(h.tags || []).join(' ')} ${h.platform} ${h.summary}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (state.category !== 'all' && !(h.categories || []).includes(state.category)) return false;
    if (state.mode !== 'all' && h.mode !== state.mode) return false;
    if (state.onlyTravelGrant && !h.hasTravelGrant) return false;
    if (state.minPrize > 0 && (h.prizeUsd || 0) < state.minPrize) return false;

    if (state.deadlineDays !== 'all') {
      if (state.deadlineDays === 'upcoming') {
        if (h.status !== 'upcoming') return false;
      } else {
        const maxD = Number(state.deadlineDays);
        if (!h.deadline) return false;
        const dLeft = (new Date(h.deadline).getTime() - now) / 86400000;
        if (dLeft < 0 || dLeft > maxD) return false;
      }
    }

    if (state.comp !== 'all') {
      const r = h.registrationsCount;
      if (state.comp === 'low' && (r === null || r >= 150)) return false;
      if (state.comp === 'low_med' && (r === null || r > 800)) return false;
      if (state.comp === 'under2000' && r !== null && r > 2000) return false;
      if (state.comp === 'high' && (r === null || r <= 800)) return false;
    }

    if (state.platform !== 'all' && h.platform !== state.platform) return false;

    return true;
  });

  list.sort((a, b) => {
    if (state.sort === 'prize_desc') return (b.prizeUsd || 0) - (a.prizeUsd || 0);
    if (state.sort === 'deadline_asc') {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    }
    if (state.sort === 'comp_asc') {
      return (a.registrationsCount ?? 999999) - (b.registrationsCount ?? 999999);
    }
    return (b.opportunityScore || 0) - (a.opportunityScore || 0);
  });

  return list;
}

function renderActiveFilterTags() {
  const tags = [];
  if (state.search) tags.push({ key: 'search', label: `"${state.search}"` });
  if (state.mode !== 'all') tags.push({ key: 'mode', label: `Mode: ${state.mode}` });
  if (state.minPrize > 0) tags.push({ key: 'minPrize', label: `Prize ≥ $${state.minPrize.toLocaleString('en-US')}` });
  if (state.deadlineDays !== 'all') tags.push({ key: 'deadlineDays', label: state.deadlineDays === 'upcoming' ? 'Upcoming' : `≤ ${state.deadlineDays}d left` });
  if (state.comp !== 'all') tags.push({ key: 'comp', label: `Competition: ${state.comp}` });
  if (state.platform !== 'all') tags.push({ key: 'platform', label: state.platform });

  const dot = document.getElementById('activeFilterDot');
  dot.classList.toggle('hidden', tags.length === 0);

  const row = document.getElementById('activeFilterTags');
  if (!tags.length) {
    row.classList.add('hidden');
    row.innerHTML = '';
    return;
  }
  row.classList.remove('hidden');
  row.innerHTML = tags
    .map(
      (t) =>
        `<span class="filter-tag-pill">${escapeHtml(t.label)} <button type="button" data-clear="${t.key}" aria-label="Remove filter">✕</button></span>`
    )
    .join('');
}

function renderTopStats() {
  const all = getAllCombined().filter((h) => (state.itemStates[h.id]?.status || 'none') !== 'hidden');
  const totalPrize = all.reduce((s, h) => s + (Number(h.prizeUsd) || 0), 0);
  const savedCount = Object.values(state.itemStates || {}).filter((x) =>
    ['saved', 'registered', 'building'].includes(x.status)
  ).length;

  document.getElementById('liveCountText').textContent = `${all.length} Live`;

  const badge = document.getElementById('savedBadge');
  badge.textContent = savedCount;
  badge.classList.toggle('hidden', savedCount === 0);

  const millions = (totalPrize / 1_000_000).toFixed(2);
  document.getElementById('spotlightStats').textContent = `${all.length} Open · $${millions}M Total Pool`;

  const okSources = (state.sourceStats || []).filter((s) => s.ok).map((s) => `${s.name} (${s.count})`);
  if (okSources.length) {
    document.getElementById('footerSummary').textContent = `Live synced: ${okSources.join(' · ')} — $${totalPrize.toLocaleString('en-US')} combined prize pool`;
  }
}

function renderGrid() {
  renderActiveFilterTags();
  const list = filterAndSortItems();
  document.getElementById('spotlightMatchCount').textContent = list.length;

  const grid = document.getElementById('cardsGrid');
  const empty = document.getElementById('emptyState');

  if (!list.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = list
    .map((h) => {
      const entry = state.itemStates[h.id] || { status: 'none', note: '' };
      const st = entry.status || 'none';
      const isSaved = ['saved', 'registered', 'building'].includes(st);
      const prizeText = formatPrizeHeadline(h);
      const isFallbackPrize = prizeText === 'Prizes & Grants';
      const comp = getCompetitionBar(h.registrationsCount);
      const cd = formatShortCountdown(h.deadline, h.dateText, h.status);

      return `
      <article class="bento-card" data-id="${escapeHtml(h.id)}">
        <div>
          <div class="card-top-bar">
            <div class="card-pills-left">
              <span class="plat-pill">${escapeHtml(h.platform)}</span>
              ${h.isHiddenGem ? '<span class="micro-pill">Gem</span>' : ''}
              ${h.hasTravelGrant ? '<span class="micro-pill">Travel Grant</span>' : ''}
            </div>
            <button type="button" class="bookmark-btn ${isSaved ? 'saved' : ''}" data-action="open-detail" data-id="${escapeHtml(h.id)}" title="Notes, Tracking & Calendar (.ICS)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8">
                <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" stroke-linejoin="round"></path>
              </svg>
            </button>
          </div>

          <div class="card-title-block">
            <h2 class="bento-title">
              <a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>
            </h2>
            <div class="bento-sub">${escapeHtml(formatCardSubtitle(h))}</div>
          </div>

          <div class="prize-block" style="margin-top: 18px;">
            <div class="bento-prize ${isFallbackPrize ? 'prize-text-fallback' : ''}">${escapeHtml(prizeText)}</div>
            <div class="comp-meter-row" title="${escapeHtml(comp.label)}">
              <span class="comp-dot ${comp.dot}"></span>
              <div class="comp-track">
                <div class="comp-fill ${comp.fill}" style="width: ${comp.pct}%"></div>
              </div>
            </div>
          </div>

          ${entry.note ? `<div class="note-indicator">${escapeHtml(entry.note)}</div>` : ''}
        </div>

        <div class="card-bottom-bar">
          <span class="time-pill ${cd.urgent ? 'urgent' : ''}" data-deadline="${escapeHtml(h.deadline || '')}" data-fallback="${escapeHtml(h.dateText || '')}" data-status="${escapeHtml(h.status || 'open')}">
            ${escapeHtml(cd.text)}
          </span>

          <div class="card-btns-right">
            <button type="button" class="card-btn-ai" data-action="ask-ai" data-id="${escapeHtml(h.id)}" title="Phân tích thể lệ & gợi ý ý tưởng với Gemini AI">✦ AI</button>
            <button type="button" class="card-btn-save ${isSaved ? 'active-state' : ''}" data-action="cycle-status" data-id="${escapeHtml(h.id)}">
              ${escapeHtml(SAVE_BUTTON_TEXT[st] || 'Save')}
            </button>
            <a href="${escapeHtml(h.url)}" target="_blank" rel="noopener" class="card-btn-apply">Apply</a>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

function tickCountdowns() {
  document.querySelectorAll('.time-pill[data-deadline]').forEach((el) => {
    const dl = el.getAttribute('data-deadline');
    if (!dl) return;
    const cd = formatShortCountdown(dl, el.getAttribute('data-fallback'), el.getAttribute('data-status'));
    el.textContent = cd.text;
    el.classList.toggle('urgent', cd.urgent);
  });

  const heroMeta = document.getElementById('heroMeta');
  const heroDl = heroMeta?.getAttribute('data-hero-deadline');
  if (heroDl) {
    const p1 = heroMeta.getAttribute('data-hero-prize') || '';
    const p3 = heroMeta.getAttribute('data-hero-third') || '';
    heroMeta.textContent = `${p1} · ${formatHeroCountdown(heroDl)} · ${p3}`;
  }
}

async function loadData() {
  try {
    const res = await fetch('/api/hackathons');
    const data = await res.json();
    applyPayload(data);
    if (data.isScanning || (!data.hackathons?.length && !loadData._retried)) {
      loadData._retried = true;
      document.getElementById('liveDot').classList.add('scanning');
      setTimeout(async () => {
        const r2 = await fetch('/api/hackathons');
        applyPayload(await r2.json());
        document.getElementById('liveDot').classList.remove('scanning');
      }, 4000);
    }
  } catch {
    showToast('Unable to reach local server');
  }
}

function applyPayload(data) {
  state.hackathons = data.hackathons || [];
  state.customHackathons = data.customHackathons || [];
  state.itemStates = data.itemStates || {};
  state.newIds = new Set(data.newIds || []);
  state.sourceStats = data.sourceStats || [];
  state.scannedAt = data.scannedAt || null;
  if (typeof data.unreadCount === 'number') {
    updateBellBadge(data.unreadCount);
  }
  renderTopStats();
  renderHero();
  renderGrid();
}

function updateBellBadge(count) {
  const b = document.getElementById('bellBadge');
  if (!b) return;
  b.textContent = count > 99 ? '99+' : String(count);
  b.classList.toggle('hidden', !count || count <= 0);
}

let lastSeenNotifId = null;

async function syncNotifications(openSheet = false) {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    updateBellBadge(data.unreadCount || 0);

    const cfg = data.settings || {};
    document.getElementById('notifyCadenceSelect').value = String(cfg.cadenceMinutes || 3);
    document.getElementById('chkNewEvents').checked = cfg.types?.newEvents !== false;
    document.getElementById('chkHiddenGems').checked = cfg.types?.hiddenGems !== false;
    document.getElementById('chkUrgent').checked = cfg.types?.urgentDeadlines !== false;
    document.getElementById('chkVnGrants').checked = cfg.types?.vietnamAndGrants !== false;

    const statusBox = document.getElementById('notifyStatusBox');
    statusBox.textContent = data.trayConnected
      ? 'Connected · System Tray App Active'
      : 'Active · Windows Native Toast ON';

    const log = data.log || [];
    if (log.length > 0) {
      if (lastSeenNotifId && log[0].id !== lastSeenNotifId) {
        // Also mirror to Web Notification if user granted browser permission
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(log[0].title, { body: log[0].message, icon: '/assets/radar-icon.png' });
          n.onclick = () => window.open(log[0].url || '/', '_blank');
        }
      }
      lastSeenNotifId = log[0].id;
    }

    const feed = document.getElementById('notifyFeedList');
    if (!log.length) {
      feed.innerHTML = '<div class="notify-empty">No alerts yet — click "Send Test Alert Now" to preview!</div>';
    } else {
      feed.innerHTML = log
        .slice(0, 15)
        .map(
          (item) => `
        <div class="notify-item">
          <div style="min-width:0;">
            <div class="notify-item-title">${escapeHtml(item.title)}</div>
            <div class="notify-item-msg">${escapeHtml(item.message)}</div>
          </div>
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener" class="card-btn-save" style="text-decoration:none; flex-shrink:0;">Open ↗</a>
        </div>`
        )
        .join('');
    }

    if (openSheet) {
      document.getElementById('notifyModal').classList.remove('hidden');
      await fetch('/api/notifications/read', { method: 'POST' });
      updateBellBadge(0);
    }
  } catch {}
}

async function saveNotifyPreferences() {
  const payload = {
    enabled: true,
    cadenceMinutes: Number(document.getElementById('notifyCadenceSelect').value) || 3,
    types: {
      newEvents: document.getElementById('chkNewEvents').checked,
      hiddenGems: document.getElementById('chkHiddenGems').checked,
      urgentDeadlines: document.getElementById('chkUrgent').checked,
      vietnamAndGrants: document.getElementById('chkVnGrants').checked,
      scanPulse: true
    }
  };
  await fetch('/api/notify-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  showToast(`Alert frequency set to every ${payload.cadenceMinutes} min`);
}

async function triggerScan() {
  const dot = document.getElementById('liveDot');
  const label = document.getElementById('liveCountText');
  dot.classList.add('scanning');
  label.textContent = 'Syncing…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    applyPayload(data);
    showToast(`Synced ${data.hackathons?.length || 0} global hackathons`);
  } catch {
    showToast('Sync error — showing cached events');
    renderTopStats();
  } finally {
    dot.classList.remove('scanning');
  }
}

async function updateItemState(id, updates) {
  const res = await fetch('/api/item-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates })
  });
  const data = await res.json();
  if (data.itemStates) {
    state.itemStates = data.itemStates;
    renderTopStats();
    renderHero();
    renderGrid();
  }
}

function openDetailModal(id) {
  const item = getAllCombined().find((x) => x.id === id);
  if (!item) return;
  state.editingId = id;
  const cur = state.itemStates[id] || { status: 'none', note: '' };
  state.editingStatus = cur.status || 'none';

  document.getElementById('modalTitle').textContent = item.title;
  document.getElementById('modalMeta').textContent = `${item.platform} · ${item.prizeDisplay} · ${formatCardSubtitle(item)}`;
  document.getElementById('modalSummary').textContent =
    item.summary || 'Open the official event page to inspect tracks, eligibility rules, and judging criteria.';
  document.getElementById('modalNote').value = cur.note || '';
  document.getElementById('modalRegLink').href = item.url;

  document.querySelectorAll('#modalStatusGroup .st-pill').forEach((b) => {
    b.classList.toggle('active', b.dataset.st === state.editingStatus);
  });

  document.getElementById('detailModal').classList.remove('hidden');
}

function exportIcs() {
  const item = getAllCombined().find((x) => x.id === state.editingId);
  if (!item) return;
  const dl = item.deadline ? new Date(item.deadline) : new Date(Date.now() + 7 * 86400000);
  const start = new Date(dl.getTime() - 2 * 3600000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hackathon Radar//Apple UI',
    'BEGIN:VEVENT',
    `UID:${item.id}@radar`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(dl)}`,
    `SUMMARY:[Hackathon] ${item.title} (${item.prizeDisplay})`,
    `DESCRIPTION:Registration & Submission: ${item.url}`,
    `URL:${item.url}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${item.title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.ics`;
  a.click();
  showToast('Calendar reminder (.ICS) downloaded');
}

function resetAllFilters() {
  state.activeTab = 'all';
  state.category = 'all';
  state.search = '';
  state.mode = 'all';
  state.minPrize = 0;
  state.deadlineDays = 'all';
  state.comp = 'all';
  state.platform = 'all';
  state.onlyTravelGrant = false;
  state.sort = 'score';

  document.getElementById('searchInput').value = '';
  document.getElementById('modeFilter').value = 'all';
  document.getElementById('prizeFilter').value = '0';
  document.getElementById('deadlineFilter').value = 'all';
  document.getElementById('compFilter').value = 'all';
  document.getElementById('platformFilter').value = 'all';
  document.getElementById('sortSelect').value = 'score';
  document.getElementById('chipTravelGrant').classList.remove('active');

  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'all'));
  document.querySelectorAll('#categoryChips .apple-chip[data-cat]').forEach((c) =>
    c.classList.toggle('active', c.dataset.cat === 'all')
  );

  renderGrid();
}

// ============================================================================
// INTERACTIONS & KEYBOARD SHORTCUTS
// ============================================================================
document.getElementById('themeSwitch').addEventListener('click', (e) => {
  const opt = e.target.closest('.theme-opt');
  if (opt) applyTheme(opt.dataset.mode);
  else applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});

document.getElementById('brandReset').addEventListener('click', (e) => {
  e.preventDefault();
  resetAllFilters();
});

document.getElementById('btnRefresh').addEventListener('click', triggerScan);

document.getElementById('navTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.activeTab = btn.dataset.tab;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderGrid();
});

document.getElementById('btnShowHidden').addEventListener('click', () => {
  state.activeTab = 'hidden';
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
  renderGrid();
});

document.getElementById('heroPrev').addEventListener('click', () => {
  state.heroIdx--;
  renderHero();
});
document.getElementById('heroNext').addEventListener('click', () => {
  state.heroIdx++;
  renderHero();
});
document.getElementById('heroSaveBtn').addEventListener('click', async (e) => {
  const id = e.currentTarget.dataset.id;
  if (!id) return;
  const order = ['none', 'saved', 'registered', 'building'];
  const cur = state.itemStates[id]?.status || 'none';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  await updateItemState(id, { status: next });
  showToast(next === 'none' ? 'Removed from Saved' : `Marked as ${SAVE_BUTTON_TEXT[next]}`);
});
document.getElementById('heroNotesBtn').addEventListener('click', (e) => {
  const id = e.currentTarget.dataset.id;
  if (id) openDetailModal(id);
});
document.getElementById('heroAskAiBtn').addEventListener('click', (e) => {
  const id = e.currentTarget.dataset.id;
  openAiDrawer(id || null);
});

document.getElementById('categoryChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.apple-chip');
  if (!chip) return;
  if (chip.dataset.travel === 'toggle') {
    state.onlyTravelGrant = !state.onlyTravelGrant;
    chip.classList.toggle('active', state.onlyTravelGrant);
    renderGrid();
    return;
  }
  state.category = chip.dataset.cat;
  document.querySelectorAll('#categoryChips .apple-chip[data-cat]').forEach((c) =>
    c.classList.toggle('active', c === chip)
  );
  renderGrid();
});

document.getElementById('sortSelect').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderGrid();
});

// Spotlight modal (⌘K / Filters)
function openSpotlight() {
  document.getElementById('spotlightModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('searchInput').focus(), 40);
}
function closeSpotlight() {
  document.getElementById('spotlightModal').classList.add('hidden');
}

document.getElementById('btnOpenSpotlight').addEventListener('click', openSpotlight);
document.getElementById('btnTuneFilters').addEventListener('click', openSpotlight);
document.getElementById('btnCloseSpotlight').addEventListener('click', closeSpotlight);
document.getElementById('btnDoneSpotlight').addEventListener('click', closeSpotlight);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSpotlight();
  } else if (e.key === 'Escape') {
    document.querySelectorAll('.sheet-backdrop').forEach((m) => m.classList.add('hidden'));
  }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderGrid();
});
document.getElementById('modeFilter').addEventListener('change', (e) => {
  state.mode = e.target.value;
  renderGrid();
});
document.getElementById('prizeFilter').addEventListener('change', (e) => {
  state.minPrize = Number(e.target.value) || 0;
  renderGrid();
});
document.getElementById('deadlineFilter').addEventListener('change', (e) => {
  state.deadlineDays = e.target.value;
  renderGrid();
});
document.getElementById('compFilter').addEventListener('change', (e) => {
  state.comp = e.target.value;
  renderGrid();
});
document.getElementById('platformFilter').addEventListener('change', (e) => {
  state.platform = e.target.value;
  renderGrid();
});

document.getElementById('activeFilterTags').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-clear]');
  if (!btn) return;
  const k = btn.dataset.clear;
  if (k === 'search') {
    state.search = '';
    document.getElementById('searchInput').value = '';
  } else if (k === 'mode') {
    state.mode = 'all';
    document.getElementById('modeFilter').value = 'all';
  } else if (k === 'minPrize') {
    state.minPrize = 0;
    document.getElementById('prizeFilter').value = '0';
  } else if (k === 'deadlineDays') {
    state.deadlineDays = 'all';
    document.getElementById('deadlineFilter').value = 'all';
  } else if (k === 'comp') {
    state.comp = 'all';
    document.getElementById('compFilter').value = 'all';
  } else if (k === 'platform') {
    state.platform = 'all';
    document.getElementById('platformFilter').value = 'all';
  }
  renderGrid();
});

document.getElementById('btnResetFilters').addEventListener('click', resetAllFilters);
document.getElementById('btnEmptyReset').addEventListener('click', resetAllFilters);

// Card actions
document.getElementById('cardsGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'cycle-status') {
    const order = ['none', 'saved', 'registered', 'building'];
    const cur = state.itemStates[id]?.status || 'none';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await updateItemState(id, { status: next });
    showToast(next === 'none' ? 'Removed from Saved' : `Status: ${SAVE_BUTTON_TEXT[next]}`);
  } else if (action === 'open-detail') {
    openDetailModal(id);
  } else if (action === 'ask-ai') {
    openAiDrawer(id);
  }
});

// Detail Sheet
document.getElementById('btnCloseDetail').addEventListener('click', () => {
  document.getElementById('detailModal').classList.add('hidden');
});
document.getElementById('modalStatusGroup').addEventListener('click', (e) => {
  const b = e.target.closest('.st-pill');
  if (!b) return;
  state.editingStatus = b.dataset.st;
  document.querySelectorAll('#modalStatusGroup .st-pill').forEach((x) => x.classList.toggle('active', x === b));
});
document.getElementById('btnSaveNote').addEventListener('click', async () => {
  const note = document.getElementById('modalNote').value;
  const st = state.editingStatus === 'none' && note.trim() ? 'saved' : state.editingStatus;
  await updateItemState(state.editingId, { status: st, note });
  document.getElementById('detailModal').classList.add('hidden');
  showToast('Saved to Radar');
});
document.getElementById('btnExportIcs').addEventListener('click', exportIcs);

// Add Custom Sheet
document.getElementById('btnOpenAdd').addEventListener('click', () => {
  document.getElementById('addModal').classList.remove('hidden');
});
document.getElementById('btnCloseAdd').addEventListener('click', () => {
  document.getElementById('addModal').classList.add('hidden');
});
document.getElementById('btnCancelAdd').addEventListener('click', () => {
  document.getElementById('addModal').classList.add('hidden');
});
document.getElementById('addHackathonForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: document.getElementById('addTitle').value,
    organizer: document.getElementById('addOrg').value,
    url: document.getElementById('addUrl').value,
    prizeUsd: document.getElementById('addPrize').value,
    deadline: document.getElementById('addDeadline').value,
    mode: document.getElementById('addMode').value,
    location: document.getElementById('addLocation').value,
    registrationsCount: document.getElementById('addRegs').value,
    hasTravelGrant: document.getElementById('addTravel').checked
  };
  const res = await fetch('/api/custom-hackathon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    state.customHackathons = data.customHackathons;
    state.itemStates = data.itemStates;
    document.getElementById('addHackathonForm').reset();
    document.getElementById('addModal').classList.add('hidden');
    renderTopStats();
    renderHero();
    renderGrid();
    showToast('Added custom hackathon');
  }
});

document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => {
    if (e.target === bd) bd.classList.add('hidden');
  });
});

// Notification Sheet events
document.getElementById('btnOpenNotify').addEventListener('click', () => syncNotifications(true));
document.getElementById('btnCloseNotify').addEventListener('click', () => {
  document.getElementById('notifyModal').classList.add('hidden');
});
document.getElementById('notifyCadenceSelect').addEventListener('change', saveNotifyPreferences);
document.getElementById('chkNewEvents').addEventListener('change', saveNotifyPreferences);
document.getElementById('chkHiddenGems').addEventListener('change', saveNotifyPreferences);
document.getElementById('chkUrgent').addEventListener('change', saveNotifyPreferences);
document.getElementById('chkVnGrants').addEventListener('change', saveNotifyPreferences);

document.getElementById('btnTestDesktopNotif').addEventListener('click', async () => {
  await fetch('/api/notify/test', { method: 'POST' });
  await syncNotifications(false);
  showToast('Sent native Windows notification!');
});

document.getElementById('btnEnableBrowserNotif').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showToast('Browser notifications not supported in this view');
    return;
  }
  const perm = await Notification.requestPermission();
  showToast(perm === 'granted' ? 'Browser notifications enabled!' : 'Permission not granted');
});

setInterval(tickCountdowns, 1000);
setInterval(() => syncNotifications(false), 12000);
loadData().then(() => {
  syncNotifications(false);
  initAiCopilot();
});

// ============================================================================
// GEMINI AI CO-PILOT CONTROLLER
// ============================================================================
const aiState = {
  hasKey: false,
  keyPreview: '',
  model: 'gemini-4-hydrogen',
  focusedId: null,
  lastInteractionId: null,
  sending: false,
  messages: [
    {
      role: 'model',
      text: 'Xin chào! Mình là **Radar AI** (chạy chuẩn **Gemini 4 Interactions API** mới nhất). Bạn có thể bấm **✦ AI** ở bất kỳ giải Hackathon nào để mình đọc thể lệ, kiểm tra điều kiện tham gia & lên ý tưởng đạt giải, hoặc hỏi mình lọc giải ngon nhất trong kho 143+ giải đang mở!'
    }
  ]
};

function renderMarkdownSafe(raw = '') {
  const lines = String(raw).split('\n');
  let html = '';
  let inList = false;

  const fmtInline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${fmtInline(trimmed.replace(/^[-*•]\s+/, ''))}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      if (trimmed) {
        html += `<p>${fmtInline(trimmed)}</p>`;
      }
    }
  }
  if (inList) html += '</ul>';
  return html || `<p>${escapeHtml(raw)}</p>`;
}

function renderAiMessages() {
  const box = document.getElementById('aiMessages');
  box.innerHTML = aiState.messages
    .map((m) => {
      if (m.role === 'user') {
        return `<div class="ai-bubble ai-bubble-user">${escapeHtml(m.text)}</div>`;
      }
      return `<div class="ai-bubble ai-bubble-model">${renderMarkdownSafe(m.text)}</div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

function renderAiQuickChips() {
  const wrap = document.getElementById('aiQuickChips');
  const focused = aiState.focusedId ? getAllCombined().find((x) => x.id === aiState.focusedId) : null;
  const prompts = focused
    ? [
        'Tóm tắt thể lệ & kiểm tra xem dev/sinh viên ở VN có hợp lệ thi giải này không?',
        'Gợi ý 3 ý tưởng dự án độc đáo dễ ăn giải nhất cho cuộc thi này',
        'Lên kiến trúc kỹ thuật & lộ trình code MVP trong 24–48 giờ'
      ]
    : [
        'Chọn lọc Top 5 giải AI/Web Online thưởng cao, ít đối thủ nhất cho người ở Việt Nam',
        'Hiện có những giải nào tại Việt Nam hoặc hỗ trợ Travel Grant đáng chú ý?',
        'Giải nào sắp hết hạn mà tỷ lệ chọi thấp dễ săn giải phụ nhất?'
      ];

  wrap.innerHTML = prompts
    .map((p) => `<button type="button" class="ai-prompt-chip" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
    .join('');
}

function updateFocusBar() {
  const bar = document.getElementById('aiFocusBar');
  const txt = document.getElementById('aiFocusText');
  if (!aiState.focusedId) {
    bar.classList.add('hidden');
    renderAiQuickChips();
    return;
  }
  const item = getAllCombined().find((x) => x.id === aiState.focusedId);
  if (!item) {
    aiState.focusedId = null;
    bar.classList.add('hidden');
    renderAiQuickChips();
    return;
  }
  txt.textContent = `Đang ghim: ${item.title} (${item.prizeDisplay})`;
  bar.classList.remove('hidden');
  renderAiQuickChips();
}

async function initAiCopilot() {
  renderAiMessages();
  renderAiQuickChips();
  try {
    const res = await fetch('/api/ai/config');
    const cfg = await res.json();
    applyAiConfig(cfg);
  } catch {}
}

function applyAiConfig(cfg) {
  aiState.hasKey = Boolean(cfg.hasKey);
  aiState.keyPreview = cfg.keyPreview || '';
  aiState.model = cfg.model || 'gemini-4-hydrogen';

  const sel = document.getElementById('aiModelSelect');
  if (Array.isArray(cfg.models) && cfg.models.length) {
    sel.innerHTML = cfg.models
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.displayName || m.id)}</option>`)
      .join('');
  }
  sel.value = aiState.model;

  const keyBox = document.getElementById('aiKeyBox');
  const statusEl = document.getElementById('aiKeySavedStatus');
  if (aiState.hasKey) {
    keyBox.classList.add('hidden');
    statusEl.textContent = `✓ Đã kết nối (${aiState.keyPreview})`;
    statusEl.classList.remove('hidden');
  } else {
    keyBox.classList.remove('hidden');
    statusEl.classList.add('hidden');
  }
}

function openAiDrawer(focusId = null) {
  if (focusId) {
    aiState.focusedId = focusId;
  }
  updateFocusBar();
  document.getElementById('aiDrawer').classList.remove('hidden');
  document.getElementById('btnAiFab').classList.add('hidden');
  setTimeout(() => {
    const inp = aiState.hasKey ? document.getElementById('aiPromptInput') : document.getElementById('aiKeyInput');
    inp?.focus();
  }, 60);
}

function closeAiDrawer() {
  document.getElementById('aiDrawer').classList.add('hidden');
  document.getElementById('btnAiFab').classList.remove('hidden');
}

async function sendAiPrompt(customText) {
  if (aiState.sending) return;
  const inp = document.getElementById('aiPromptInput');
  const text = (customText !== undefined ? customText : inp.value).trim();
  if (!text) return;

  if (!aiState.hasKey) {
    document.getElementById('aiKeyBox').classList.remove('hidden');
    document.getElementById('aiKeyInput').focus();
    showToast('Dán Gemini API Key ở khung trên để bắt đầu chat!');
    return;
  }

  inp.value = '';
  aiState.messages.push({ role: 'user', text });
  aiState.messages.push({ role: 'model', text: 'Đang đọc dữ liệu giải đấu & phân tích cùng Gemini…' });
  renderAiMessages();

  aiState.sending = true;
  document.getElementById('btnSendAi').disabled = true;

  try {
    const historyToSend = aiState.messages.slice(0, -1).filter((m, idx) => idx > 0 || m.role === 'user');
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: historyToSend,
        previousInteractionId: aiState.lastInteractionId,
        focusedId: aiState.focusedId,
        model: document.getElementById('aiModelSelect').value
      })
    });
    const data = await res.json();
    aiState.messages.pop();
    if (!res.ok || data.error) {
      aiState.messages.push({ role: 'model', text: `⚠️ Lỗi Gemini API: ${data.error || 'Không xác định'}` });
    } else {
      if (data.interactionId) aiState.lastInteractionId = data.interactionId;
      aiState.messages.push({ role: 'model', text: data.reply });
    }
  } catch (err) {
    aiState.messages.pop();
    aiState.messages.push({ role: 'model', text: `⚠️ Không thể kết nối: ${err.message}` });
  } finally {
    aiState.sending = false;
    document.getElementById('btnSendAi').disabled = false;
    renderAiMessages();
  }
}

document.getElementById('btnOpenAiNav').addEventListener('click', () => openAiDrawer(null));
document.getElementById('btnAiFab').addEventListener('click', () => openAiDrawer(null));
document.getElementById('btnCloseAi').addEventListener('click', closeAiDrawer);

document.getElementById('btnToggleKeyBox').addEventListener('click', () => {
  document.getElementById('aiKeyBox').classList.toggle('hidden');
});

document.getElementById('btnClearFocus').addEventListener('click', () => {
  aiState.focusedId = null;
  updateFocusBar();
});

document.getElementById('btnClearChat').addEventListener('click', () => {
  aiState.lastInteractionId = null;
  aiState.messages = [
    {
      role: 'model',
      text: 'Đã tạo phiên trò chuyện mới! Bạn muốn mình tư vấn giải nào hoặc gợi ý ý tưởng dự án gì?'
    }
  ];
  renderAiMessages();
});

document.getElementById('btnSaveAiKey').addEventListener('click', async () => {
  const key = document.getElementById('aiKeyInput').value.trim();
  if (!key) {
    showToast('Vui lòng dán mã Gemini API Key');
    return;
  }
  const btn = document.getElementById('btnSaveAiKey');
  btn.textContent = 'Đang kiểm tra…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`API Key chưa hợp lệ: ${data.error || ''}`);
    } else {
      document.getElementById('aiKeyInput').value = '';
      applyAiConfig(data);
      showToast('✓ Đã kết nối Gemini API thành công!');
    }
  } catch {
    showToast('Không thể kiểm tra API Key lúc này');
  } finally {
    btn.textContent = 'Kết nối';
    btn.disabled = false;
  }
});

document.getElementById('aiModelSelect').addEventListener('change', async (e) => {
  aiState.model = e.target.value;
  await fetch('/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: aiState.model })
  });
});

document.getElementById('aiQuickChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.ai-prompt-chip');
  if (!chip) return;
  sendAiPrompt(chip.dataset.prompt);
});

document.getElementById('aiChatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAiPrompt();
});

document.getElementById('aiPromptInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiPrompt();
  }
});

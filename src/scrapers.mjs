import dns from 'node:dns';
import fs from 'node:fs/promises';
import path from 'node:path';

// Ensure reliable IPv4 resolution on Windows / ISP networks
dns.setDefaultResultOrder('ipv4first');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CURRENCY_RATES = {
  USD: 1,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  $: 1,
  EUR: 1.08,
  '€': 1.08,
  GBP: 1.27,
  '£': 1.27,
  CAD: 0.72,
  'CA$': 0.72,
  'C$': 0.72,
  AUD: 0.65,
  'A$': 0.65,
  SGD: 0.74,
  'S$': 0.74,
  INR: 0.0118,
  '₹': 0.0118,
  'fa-rupee': 0.0118,
  VND: 0.000039,
  '₫': 0.000039,
  JPY: 0.0065,
  '¥': 0.0065,
  BRL: 0.18,
  'R$': 0.18
};

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

async function fetchText(url, options = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/html, */*',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return await res.text();
}

function stripHtml(str = '') {
  return String(str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse Devpost date strings like:
 * - "Sep 24 - Nov 18, 2026"
 * - "Nov 11 - 30, 2026"
 * - "Nov 17, 2026 - Jan 12, 2027"
 * - "Dec 05, 2026"
 */
export function parseDevpostDates(dateRangeStr = '', timeLeftStr = '') {
  const now = new Date();
  let startDate = null;
  let deadline = null;

  const clean = String(dateRangeStr).trim();
  // Pattern 1: "Nov 17, 2026 - Jan 12, 2027"
  let m = clean.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    startDate = new Date(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), 0, 0, 0);
    deadline = new Date(Number(m[6]), MONTHS[m[4].toLowerCase()], Number(m[5]), 23, 59, 59);
  }

  // Pattern 2: "Oct 30 - Dec 04, 2026"
  if (!deadline) {
    m = clean.match(/^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const yr = Number(m[5]);
      startDate = new Date(yr, MONTHS[m[1].toLowerCase()], Number(m[2]), 0, 0, 0);
      deadline = new Date(yr, MONTHS[m[3].toLowerCase()], Number(m[4]), 23, 59, 59);
    }
  }

  // Pattern 3: "Nov 11 - 30, 2026"
  if (!deadline) {
    m = clean.match(/^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const yr = Number(m[4]);
      const mo = MONTHS[m[1].toLowerCase()];
      startDate = new Date(yr, mo, Number(m[2]), 0, 0, 0);
      deadline = new Date(yr, mo, Number(m[3]), 23, 59, 59);
    }
  }

  // Pattern 4: "Dec 04, 2026"
  if (!deadline) {
    m = clean.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const yr = Number(m[3]);
      const mo = MONTHS[m[1].toLowerCase()];
      startDate = new Date(yr, mo, Number(m[2]), 0, 0, 0);
      deadline = new Date(yr, mo, Number(m[2]), 23, 59, 59);
    }
  }

  // Refine short countdowns from time_left_to_submission ("14 hours left", "42 minutes left")
  const tl = String(timeLeftStr).toLowerCase();
  const hrMatch = tl.match(/(\d+)\s*hour/);
  const minMatch = tl.match(/(\d+)\s*minute/);
  if (hrMatch) {
    deadline = new Date(now.getTime() + Number(hrMatch[1]) * 3600 * 1000);
  } else if (minMatch) {
    deadline = new Date(now.getTime() + Number(minMatch[1]) * 60 * 1000);
  }

  return {
    startDate: startDate && !isNaN(startDate) ? startDate.toISOString() : null,
    deadline: deadline && !isNaN(deadline) ? deadline.toISOString() : null
  };
}

export function parsePrizeString(raw = '') {
  if (!raw) return { prizeUsd: 0, prizeDisplay: 'Giải thưởng hiện vật / Vinh danh' };
  const clean = stripHtml(raw).replace(/([$€£₹₫¥])\s+/g, '$1');
  const numMatch = clean.match(/([\d,]+(?:\.\d+)?)/);
  if (!numMatch) return { prizeUsd: 0, prizeDisplay: clean || 'Giải thưởng hiện vật' };

  const numeric = parseFloat(numMatch[1].replace(/,/g, '')) || 0;
  let rate = 1;
  if (clean.includes('₹') || /\bINR\b/i.test(clean)) rate = CURRENCY_RATES.INR;
  else if (clean.includes('€') || /\bEUR\b/i.test(clean)) rate = CURRENCY_RATES.EUR;
  else if (clean.includes('£') || /\bGBP\b/i.test(clean)) rate = CURRENCY_RATES.GBP;
  else if (/CA\$|\bCAD\b/i.test(clean)) rate = CURRENCY_RATES.CAD;
  else if (/A\$|\bAUD\b/i.test(clean)) rate = CURRENCY_RATES.AUD;
  else if (/S\$|\bSGD\b/i.test(clean)) rate = CURRENCY_RATES.SGD;
  else if (clean.includes('₫') || /\bVND\b/i.test(clean)) rate = CURRENCY_RATES.VND;
  else if (clean.includes('¥') || /\bJPY\b/i.test(clean)) rate = CURRENCY_RATES.JPY;
  else if (/R\$|\bBRL\b/i.test(clean)) rate = CURRENCY_RATES.BRL;

  const prizeUsd = Math.round(numeric * rate);
  let prizeDisplay = clean;
  if (rate !== 1 && prizeUsd > 0) {
    prizeDisplay = `${clean} (~$${prizeUsd.toLocaleString('en-US')})`;
  } else if (prizeUsd > 0 && !clean.includes('$')) {
    prizeDisplay = `$${prizeUsd.toLocaleString('en-US')}`;
  }
  return { prizeUsd, prizeDisplay };
}

export function classifyCategories(texts = []) {
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  const cats = new Set();

  if (/\b(ai|artificial intelligence|machine learning|ml|llm|genai|generative|agent|agents|nlp|computer vision|deep learning|data science|gpt|gemini|claude|neural)\b/.test(blob)) {
    cats.add('ai');
  }
  if (/\b(web3|blockchain|crypto|defi|ethereum|solana|smart contract|nft|zk|onchain|dao|bitcoin|bch|aptos|sui|evm|omni)\b/.test(blob)) {
    cats.add('web3');
  }
  if (/\b(game|gaming|gamedev|ar\/vr|ar|vr|xr|metaverse|unity|unreal|3d|spatial|smart glasses)\b/.test(blob)) {
    cats.add('game_xr');
  }
  if (/\b(fintech|finance|payment|payments|banking|trading|cyber|security|cybersecurity|privacy|iot|hardware|robotics|quantum|silicon|electronics|embedded|chip)\b/.test(blob)) {
    cats.add('fintech_sec');
  }
  if (/\b(web|mobile|app|saas|cloud|open source|open-ended|open ended|productivity|devtools|developer|api|software|social|education|edtech|health|healthtech|climate|sustainability|beginner)\b/.test(blob)) {
    cats.add('web_app');
  }

  if (cats.size === 0) cats.add('web_app');
  return [...cats];
}

export function classifyModeAndLocation({ isOnline, locationText = '', country = '', description = '', platform = '' }) {
  const loc = `${locationText} ${country}`.trim();
  const lowerLoc = loc.toLowerCase();
  const fullBlob = `${loc} ${description}`.toLowerCase();

  const isVietnam = /\b(vietnam|việt nam|viet nam|hanoi|hà nội|ha noi|ho chi minh|hcmc|saigon|sài gòn|da nang|đà nẵng|bach khoa)\b/i.test(fullBlob);

  let mode = 'online';
  if (isVietnam) {
    mode = 'vietnam';
  } else if (isOnline || /\b(online|virtual|digital|remote|global|everywhere)\b/i.test(lowerLoc) || !loc) {
    mode = 'online';
  } else {
    mode = 'international';
  }

  const hasTravelGrant =
    /\b(travel grant|travel reimbursement|travel support|flight|flights|airfare|accommodation|hotel|scholarship|hacker pack|travel stipend|free stay)\b/i.test(fullBlob) ||
    (platform === 'ETHGlobal' && mode === 'international');

  let displayLocation = locationText || country || (mode === 'online' ? 'Online Toàn Cầu' : 'Quốc tế');
  if (/^online$/i.test(displayLocation.trim())) displayLocation = 'Online Toàn Cầu';

  return { mode, isVietnam, hasTravelGrant, displayLocation };
}

export function computeCompetitionAndScore(item) {
  const regs = typeof item.registrationsCount === 'number' ? item.registrationsCount : null;
  let competitionLevel = 'unknown'; // low | medium | high | unknown
  if (regs !== null) {
    if (regs < 150) competitionLevel = 'low';
    else if (regs <= 800) competitionLevel = 'medium';
    else competitionLevel = 'high';
  }

  const now = Date.now();
  const dl = item.deadline ? new Date(item.deadline).getTime() : null;
  const daysLeft = dl ? (dl - now) / (1000 * 3600 * 24) : 14;

  // Opportunity Score (0 - 100): favors high prize pool, open status, reasonable competition, and active deadlines
  let score = 40;
  if (item.prizeUsd > 0) {
    score += Math.min(38, Math.log10(item.prizeUsd + 10) * 8); // $10k -> +32, $100k -> +38
  }
  if (regs !== null) {
    if (regs < 100) score += 18;
    else if (regs < 300) score += 13;
    else if (regs < 800) score += 6;
    else if (regs > 2500) score -= 8;
  } else {
    score += 5;
  }
  if (item.mode === 'vietnam') score += 12;
  if (item.mode === 'online') score += 6;
  if (item.hasTravelGrant) score += 8;
  if (daysLeft > 0 && daysLeft <= 21) score += 5;
  if (daysLeft < 0) score -= 50;

  score = Math.max(5, Math.min(99, Math.round(score)));

  // Hidden Gem: >= $3,000 prize (or ETHGlobal/Vietnam) & < 350 registered competitors & still open
  const isHiddenGem =
    daysLeft > 0 &&
    ((item.prizeUsd >= 3000 && regs !== null && regs < 350) ||
      (item.prizeUsd >= 20000 && regs !== null && regs < 900));

  return { competitionLevel, opportunityScore: score, isHiddenGem };
}

function finalizeHackathon(raw) {
  const { mode, isVietnam, hasTravelGrant, displayLocation } = classifyModeAndLocation({
    isOnline: raw.isOnline,
    locationText: raw.locationText,
    country: raw.country,
    description: `${raw.title} ${raw.summary || ''} ${(raw.tags || []).join(' ')}`,
    platform: raw.platform
  });

  const categories = classifyCategories([
    raw.title,
    raw.summary,
    ...(raw.tags || [])
  ]);

  const item = {
    id: raw.id,
    platform: raw.platform,
    title: raw.title,
    organizer: raw.organizer || raw.platform,
    url: raw.url,
    thumbnail: raw.thumbnail || null,
    status: raw.status || 'open', // open | upcoming
    startDate: raw.startDate || null,
    deadline: raw.deadline || null,
    dateText: raw.dateText || '',
    prizeUsd: raw.prizeUsd || 0,
    prizeDisplay: raw.prizeDisplay || 'Xem trên trang chủ',
    registrationsCount: typeof raw.registrationsCount === 'number' ? raw.registrationsCount : null,
    mode,
    isVietnam,
    hasTravelGrant,
    location: displayLocation,
    teamSize: raw.teamSize || null,
    tags: (raw.tags || []).slice(0, 6),
    categories,
    summary: raw.summary ? stripHtml(raw.summary).slice(0, 280) : ''
  };

  return {
    ...item,
    ...computeCompetitionAndScore(item)
  };
}

// ============================================================================
// 1. DEVPOST PARSER & FETCHER
// ============================================================================
export function parseDevpostJson(json) {
  const list = json?.hackathons || [];
  const results = [];
  for (const h of list) {
    if (h.open_state === 'ended' || h.winners_announced) continue;
    if (h.invite_only) continue;

    const { startDate, deadline } = parseDevpostDates(h.submission_period_dates, h.time_left_to_submission);
    const { prizeUsd, prizeDisplay } = parsePrizeString(h.prize_amount);
    const locName = h.displayed_location?.location || 'Online';
    const isOnline = h.displayed_location?.icon === 'globe' || /^online$/i.test(locName);
    const thumb = h.thumbnail_url
      ? h.thumbnail_url.startsWith('//')
        ? `https:${h.thumbnail_url}`
        : h.thumbnail_url
      : null;

    results.push(
      finalizeHackathon({
        id: `devpost-${h.id}`,
        platform: 'Devpost',
        title: stripHtml(h.title),
        organizer: h.organization_name || 'Devpost Organizer',
        url: h.url,
        thumbnail: thumb,
        status: h.open_state === 'upcoming' ? 'upcoming' : 'open',
        startDate,
        deadline,
        dateText: h.submission_period_dates || h.time_left_to_submission || '',
        prizeUsd,
        prizeDisplay,
        registrationsCount: typeof h.registrations_count === 'number' ? h.registrations_count : null,
        isOnline,
        locationText: locName,
        tags: (h.themes || []).map((t) => t.name),
        summary: h.eligibility_requirement_invite_only_description || ''
      })
    );
  }
  return results;
}

async function fetchDevpost() {
  const urls = [
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=prize-amount&page=1',
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=prize-amount&page=2',
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=prize-amount&page=3',
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=recently-added&page=1',
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=recently-added&page=2',
    'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=submission-deadline&page=1',
    'https://devpost.com/api/hackathons?search=Vietnam&page=1',
    'https://devpost.com/api/hackathons?search=Hanoi&page=1',
    'https://devpost.com/api/hackathons?search=Ho+Chi+Minh&page=1',
    'https://devpost.com/api/hackathons?challenge_type[]=in-person&status[]=upcoming&status[]=open&order_by=prize-amount&page=1'
  ];

  const settled = await Promise.allSettled(urls.map((u) => fetchText(u)));
  const map = new Map();
  let okCount = 0;

  for (const res of settled) {
    if (res.status === 'fulfilled') {
      okCount++;
      try {
        const items = parseDevpostJson(JSON.parse(res.value));
        for (const it of items) map.set(it.id, it);
      } catch {}
    }
  }
  if (okCount === 0) throw new Error('Không thể kết nối Devpost API');
  return [...map.values()];
}

// ============================================================================
// 2. UNSTOP PARSER & FETCHER
// ============================================================================
export function parseUnstopJson(json) {
  const rows = json?.data?.data || [];
  const results = [];
  for (const r of rows) {
    if (r.regn_open === 0) continue;

    let totalUsd = 0;
    let rawCash = 0;
    let rawCurr = 'USD';
    if (Array.isArray(r.prizes)) {
      for (const p of r.prizes) {
        const c = Number(p.cash) || 0;
        if (c > 0) {
          const code = p.currencyCode || p.currency || 'INR';
          rawCurr = code === 'fa-rupee' ? 'INR' : code;
          rawCash += c;
          const rate = CURRENCY_RATES[rawCurr] || CURRENCY_RATES[p.currency] || 0.0118;
          totalUsd += c * rate;
        }
      }
    }
    totalUsd = Math.round(totalUsd);
    let prizeDisplay = 'Giải thưởng & Chứng nhận';
    if (totalUsd > 0) {
      if (rawCurr === 'USD') {
        prizeDisplay = `$${totalUsd.toLocaleString('en-US')}`;
      } else if (rawCurr === 'INR') {
        prizeDisplay = `₹${rawCash.toLocaleString('en-IN')} (~$${totalUsd.toLocaleString('en-US')})`;
      } else {
        prizeDisplay = `${rawCash.toLocaleString('en-US')} ${rawCurr} (~$${totalUsd.toLocaleString('en-US')})`;
      }
    }

    const deadline = r.regnRequirements?.end_regn_dt || r.end_date || null;
    if (deadline && new Date(deadline).getTime() < Date.now()) continue;

    const minT = r.regnRequirements?.min_team_size;
    const maxT = r.regnRequirements?.max_team_size;
    const teamSize = minT && maxT ? (minT === maxT ? `${minT} người` : `${minT}–${maxT} người`) : null;
    const isOnline = /^online$/i.test(r.region || '');
    const cityCountry = Array.isArray(r.locations) && r.locations.length > 0 ? r.locations.join(', ') : (isOnline ? 'Online' : 'International');
    const url = r.public_url?.startsWith('http') ? r.public_url : `https://unstop.com/${String(r.public_url || '').replace(/^\//, '')}`;

    results.push(
      finalizeHackathon({
        id: `unstop-${r.id}`,
        platform: 'Unstop',
        title: stripHtml(r.title),
        organizer: r.organisation?.name || 'Unstop Organizer',
        url,
        thumbnail: r.logoUrl2 || r.thumb || null,
        status: 'open',
        startDate: r.regnRequirements?.start_regn_dt || null,
        deadline,
        dateText: r.regnRequirements?.remain_days || '',
        prizeUsd: totalUsd,
        prizeDisplay,
        registrationsCount: typeof r.registerCount === 'number' ? r.registerCount : null,
        isOnline,
        locationText: cityCountry,
        teamSize,
        tags: [
          ...(Array.isArray(r.required_skills) ? r.required_skills.map((s) => s.skill_name || s.name || s) : []),
          r.subtype ? r.subtype.replace(/_/g, ' ') : ''
        ].filter(Boolean),
        summary: r.details || ''
      })
    );
  }
  return results;
}

async function fetchUnstop() {
  const urls = [
    'https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=1&per_page=20&oppstatus=open',
    'https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=2&per_page=20&oppstatus=open'
  ];
  const settled = await Promise.allSettled(
    urls.map((u) => fetchText(u, { headers: { Referer: 'https://unstop.com/hackathons' } }))
  );
  const map = new Map();
  let ok = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      ok++;
      try {
        for (const item of parseUnstopJson(JSON.parse(s.value))) map.set(item.id, item);
      } catch {}
    }
  }
  if (ok === 0) throw new Error('Không thể kết nối Unstop API');
  return [...map.values()];
}

// ============================================================================
// 3. DEVFOLIO PARSER & FETCHER
// ============================================================================
export function parseDevfolioJson(json) {
  const hits = json?.hits?.hits || [];
  const results = [];
  for (const hit of hits) {
    const s = hit._source;
    if (!s || s.private) continue;

    const regEnd = s.hackathon_setting?.reg_ends_at || s.ends_at || null;
    if (regEnd && new Date(regEnd).getTime() < Date.now()) continue;

    // Extract any monetary prize mentions in prizes array or description
    let prizeUsd = 0;
    let prizeDisplay = s.prizes?.length ? `${s.prizes.length} hạng mục giải thưởng` : 'Giải thưởng hấp dẫn';
    const prizeBlob = JSON.stringify(s.prizes || []) + ' ' + (s.desc || '');
    const usdMatches = [...prizeBlob.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/gi)];
    if (usdMatches.length > 0) {
      let maxVal = 0;
      for (const m of usdMatches) {
        let v = parseFloat(m[1].replace(/,/g, '')) || 0;
        if (m[2]) v *= 1000;
        if (v > maxVal && v < 10000000) maxVal = v;
      }
      if (maxVal > 0) {
        prizeUsd = Math.round(maxVal);
        prizeDisplay = `~$${prizeUsd.toLocaleString('en-US')}+`;
      }
    } else {
      const inrMatches = [...prizeBlob.matchAll(/₹\s*([\d,]+)/g)];
      if (inrMatches.length > 0) {
        let maxInr = 0;
        for (const m of inrMatches) {
          const v = parseFloat(m[1].replace(/,/g, '')) || 0;
          if (v > maxInr) maxInr = v;
        }
        if (maxInr > 0) {
          prizeUsd = Math.round(maxInr * CURRENCY_RATES.INR);
          prizeDisplay = `₹${maxInr.toLocaleString('en-IN')} (~$${prizeUsd.toLocaleString('en-US')})`;
        }
      }
    }

    const isOnline = Boolean(s.is_online) || s.apply_mode === 'online' || s.apply_mode === 'both';
    const locParts = [s.city, s.state, s.country].filter(Boolean).join(', ');
    const locText = s.apply_mode === 'both'
      ? `Hybrid (${locParts || 'Online & Offline'})`
      : isOnline
        ? 'Online'
        : locParts || s.location || 'In-Person';

    const teamSize = s.team_min && s.team_size ? `${s.team_min}–${s.team_size} người` : null;
    const url = s.hackathon_setting?.external_apply_url || `https://${s.slug}.devfolio.co/`;
    const now = Date.now();
    const regStarts = s.hackathon_setting?.reg_starts_at ? new Date(s.hackathon_setting.reg_starts_at).getTime() : 0;

    results.push(
      finalizeHackathon({
        id: `devfolio-${s.uuid || s.slug}`,
        platform: 'Devfolio',
        title: s.name,
        organizer: s.hosted_by || s.tagline || 'Devfolio Community',
        url,
        thumbnail: s.hackathon_setting?.logo || s.cover_img || null,
        status: regStarts > now ? 'upcoming' : 'open',
        startDate: s.starts_at || null,
        deadline: regEnd,
        dateText: '',
        prizeUsd,
        prizeDisplay,
        registrationsCount: typeof s.participants_count === 'number' ? s.participants_count : null,
        isOnline,
        locationText: locText,
        country: s.country || '',
        teamSize,
        tags: [
          ...(s.themes || []).map((t) => t.name || t),
          ...(s.hashtags || []),
          s.apply_mode === 'both' ? 'Hybrid' : ''
        ].filter(Boolean),
        summary: `${s.tagline || ''} — ${s.desc || ''}`
      })
    );
  }
  return results;
}

async function fetchDevfolio() {
  const types = ['application_open', 'upcoming'];
  const settled = await Promise.allSettled(
    types.map((type) =>
      fetchText('https://api.devfolio.co/api/search/hackathons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://devfolio.co',
          Referer: 'https://devfolio.co/'
        },
        body: JSON.stringify({ type, from: 0, size: 25 })
      })
    )
  );
  const map = new Map();
  let ok = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      ok++;
      try {
        for (const item of parseDevfolioJson(JSON.parse(s.value))) map.set(item.id, item);
      } catch {}
    }
  }
  if (ok === 0) throw new Error('Không thể kết nối Devfolio API');
  return [...map.values()];
}

// ============================================================================
// 4. MLH (MAJOR LEAGUE HACKING) PARSER & FETCHER
// ============================================================================
export function parseMLHHtml(html) {
  const m = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const events = data?.props?.upcomingEvents || [];
  const results = [];

  for (const ev of events) {
    const ends = ev.endsAt ? new Date(ev.endsAt).getTime() : 0;
    if (ends && ends < Date.now()) continue;

    const isOnline = ev.formatType === 'digital' || /digital|online|everywhere|global/i.test(ev.location || '');
    const focus = ev.customFields?.hackathon_focus || [];
    const url = ev.websiteUrl || (ev.url ? `https://mlh.io${ev.url}` : 'https://mlh.io/seasons/2027/events');

    results.push(
      finalizeHackathon({
        id: `mlh-${ev.id || ev.slug}`,
        platform: 'MLH',
        title: ev.name,
        organizer: ev.organizationName || `Major League Hacking (${ev.region || 'Global'})`,
        url,
        thumbnail: ev.logoUrl || ev.backgroundUrl || null,
        status: ev.status === 'active' ? 'open' : 'open',
        startDate: ev.startsAt || null,
        deadline: ev.startsAt || ev.endsAt || null,
        dateText: ev.dateRange || '',
        prizeUsd: 0,
        prizeDisplay: 'Giải thưởng MLH & Nhà tài trợ',
        registrationsCount: null,
        isOnline,
        locationText: ev.location || (isOnline ? 'Online' : ''),
        country: ev.venueAddress?.country || '',
        tags: ['MLH Official', ev.region, ...focus].filter(Boolean),
        summary: `Giải Hackathon chính thức thuộc hệ thống Major League Hacking (${ev.dateRange || ''}) tại ${ev.location || 'Online'}.`
      })
    );
  }
  return results;
}

async function fetchMLH() {
  const html = await fetchText('https://mlh.io/seasons/2027/events');
  return parseMLHHtml(html);
}

// ============================================================================
// 5. ETHGLOBAL PARSER & FETCHER
// ============================================================================
export function parseETHGlobalHtml(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)]
    .map((x) => {
      try {
        return JSON.parse('"' + x[1] + '"');
      } catch {
        return '';
      }
    })
    .join('');

  const matches = [...chunks.matchAll(/\{"id":\d+,"name":"[^"]+","slug":"[^"]+","type":"hackathon"[\s\S]*?\}\}(?=,\{"id":|\]\})/g)];
  const map = new Map();

  for (const hm of matches) {
    try {
      const ev = JSON.parse(hm[0]);
      if (ev.status === 'finished') continue;
      const deadline = ev.signupDeadline || ev.endTime || ev.startTime;
      if (deadline && new Date(deadline).getTime() < Date.now()) continue;

      const isOnline = ev.medium === 'virtual';
      const cityStr = ev.city ? `${ev.city.name}, ${ev.city.country?.name || ev.city.countryCode || ''}`.replace(/,\s*$/, '') : (isOnline ? 'Online Toàn Cầu' : 'International');
      const ogImg = ev.style?.global?.meta?.ogImage || null;

      const item = finalizeHackathon({
        id: `ethglobal-${ev.slug}`,
        platform: 'ETHGlobal',
        title: ev.name,
        organizer: 'ETHGlobal',
        url: ev.website || `https://ethglobal.com/events/${ev.slug}`,
        thumbnail: ogImg,
        status: ev.status === 'active' ? 'open' : 'open',
        startDate: ev.startTime || null,
        deadline,
        dateText: '',
        prizeUsd: isOnline ? 100000 : 350000,
        prizeDisplay: isOnline ? '~$100,000+ Pool (Ước tính)' : '~$350,000+ Pool & Hacker Pack',
        registrationsCount: null,
        isOnline,
        locationText: cityStr,
        country: ev.city?.country?.name || '',
        tags: ['Web3', 'Ethereum', 'Blockchain', isOnline ? 'Virtual' : 'Hacker Pack / Grants'],
        summary: ev.tagline || `Siêu giải Hackathon Web3 quốc tế của ETHGlobal (${isOnline ? 'Thi Online toàn cầu' : `Tổ chức tại ${cityStr}, thường kèm Hacker Pack & cơ hội Travel Grant`}).`
      });
      map.set(item.id, item);
    } catch {}
  }
  return [...map.values()];
}

async function fetchETHGlobal() {
  const html = await fetchText('https://ethglobal.com/events', {}, 20000);
  return parseETHGlobalHtml(html);
}

// ============================================================================
// 6. DORAHACKS PARSER & FETCHER
// ============================================================================
export function parseDoraHacksHtml(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const arr = JSON.parse(m[1]);
  const results = [];

  for (let i = 0; i < arr.length - 1; i++) {
    const img = arr[i];
    const p = arr[i + 1];
    if (typeof img === 'string' && img.includes('cdn.dorahacks.io') && typeof p === 'string' && p.startsWith('/hackathon/')) {
      const slug = p.replace(/^\/hackathon\/|\/$/g, '');
      if (!slug) continue;
      const prettyTitle = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bAi\b/g, 'AI')
        .replace(/\bApi\b/g, 'API')
        .replace(/\bBch\b/g, 'BCH')
        .replace(/\bQday\b/g, 'QDay Quantum');

      results.push(
        finalizeHackathon({
          id: `dorahacks-${slug}`,
          platform: 'DoraHacks',
          title: `${prettyTitle} (Featured BUIDL)`,
          organizer: 'DoraHacks Global',
          url: `https://dorahacks.io${p}`,
          thumbnail: img,
          status: 'open',
          startDate: null,
          deadline: null,
          dateText: 'Đang mở đăng ký nổi bật',
          prizeUsd: 25000,
          prizeDisplay: 'Quỹ thưởng Featured DoraHacks',
          registrationsCount: null,
          isOnline: true,
          locationText: 'Online Toàn Cầu',
          tags: ['Featured', 'Frontier Tech', 'BUIDL'],
          summary: `Giải Hackathon công nghệ mũi nhọn đang được ghim nổi bật (Featured Banner) trên trang chủ DoraHacks.`
        })
      );
    }
  }
  return results;
}

async function fetchDoraHacks() {
  const html = await fetchText('https://dorahacks.io/hackathon');
  return parseDoraHacksHtml(html);
}

// ============================================================================
// MASTER AGGREGATOR
// ============================================================================
export async function scanAllGlobalHackathons() {
  const sources = [
    { name: 'Devpost', fn: fetchDevpost },
    { name: 'Unstop', fn: fetchUnstop },
    { name: 'Devfolio', fn: fetchDevfolio },
    { name: 'MLH', fn: fetchMLH },
    { name: 'ETHGlobal', fn: fetchETHGlobal },
    { name: 'DoraHacks', fn: fetchDoraHacks }
  ];

  const startedAt = Date.now();
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const t0 = Date.now();
      const items = await s.fn();
      return { name: s.name, items, ms: Date.now() - t0 };
    })
  );

  const sourceStats = [];
  const dedup = new Map();

  for (let i = 0; i < sources.length; i++) {
    const name = sources[i].name;
    const res = settled[i];
    if (res.status === 'fulfilled') {
      sourceStats.push({
        name,
        ok: true,
        count: res.value.items.length,
        ms: res.value.ms
      });
      for (const item of res.value.items) {
        // Deduplicate by normalized title if cross-listed
        const normKey = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = dedup.get(normKey);
        if (!existing || (item.prizeUsd > existing.prizeUsd) || (item.registrationsCount !== null && existing.registrationsCount === null)) {
          dedup.set(normKey, item);
        }
      }
    } else {
      sourceStats.push({
        name,
        ok: false,
        count: 0,
        error: res.reason?.message || 'Lỗi kết nối'
      });
    }
  }

  const hackathons = [...dedup.values()].sort((a, b) => b.opportunityScore - a.opportunityScore);
  return {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sourceStats,
    hackathons
  };
}

/**
 * Offline sample parser for unit-testing in sandboxed environments
 */
export async function parseOfflineSamples(samplesDir) {
  const items = [];
  try {
    const dp = JSON.parse(await fs.readFile(path.join(samplesDir, 'devpost_open.json'), 'utf8'));
    const dpVn = JSON.parse(await fs.readFile(path.join(samplesDir, 'devpost_vn.json'), 'utf8'));
    items.push(...parseDevpostJson(dp), ...parseDevpostJson(dpVn));
  } catch {}
  try {
    const us = JSON.parse(await fs.readFile(path.join(samplesDir, 'unstop.json'), 'utf8'));
    items.push(...parseUnstopJson(us));
  } catch {}
  try {
    const df = JSON.parse(await fs.readFile(path.join(samplesDir, 'devfolio.json'), 'utf8'));
    items.push(...parseDevfolioJson(df));
  } catch {}
  try {
    const mlh = await fs.readFile(path.join(samplesDir, 'mlh.html'), 'utf8');
    items.push(...parseMLHHtml(mlh));
  } catch {}
  try {
    const eth = await fs.readFile(path.join(samplesDir, 'ethglobal.html'), 'utf8');
    items.push(...parseETHGlobalHtml(eth));
  } catch {}
  try {
    const dora = await fs.readFile(path.join(samplesDir, 'dorahacks.html'), 'utf8');
    items.push(...parseDoraHacksHtml(dora));
  } catch {}
  return items;
}

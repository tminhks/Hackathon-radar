import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const pageDigestCache = new Map();

export const CURRENT_GEMINI_MODELS = [
  { id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen (Nhanh & Cân bằng)' },
  { id: 'gemini-4-argon', displayName: 'Gemini 4 Argon (Suy luận nhanh)' },
  { id: 'gemini-4-carbon', displayName: 'Gemini 4 Carbon (Suy luận sâu nhất)' },
  { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite (Siêu tốc)' }
];

function cleanHtmlToText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchHackathonPageDigest(url) {
  if (!url || !url.startsWith('http')) return '';
  const cached = pageDigestCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
    return cached.text;
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return '';
    const html = await res.text();
    const text = cleanHtmlToText(html).slice(0, 7500);
    pageDigestCache.set(url, { text, fetchedAt: Date.now() });
    return text;
  } catch {
    return '';
  }
}

export async function listGeminiModels(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Chưa nhập Gemini API Key');

  // Verify API key against the Gemini API models endpoint
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(10000)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `API Key không hợp lệ (HTTP ${res.status})`);
  }

  return {
    models: CURRENT_GEMINI_MODELS,
    preferredModel: 'gemini-4-hydrogen'
  };
}

function buildSystemInstruction({ allHackathons = [], itemStates = {}, focusedHackathon = null, pageDigest = '' }) {
  const nowStr = new Date().toISOString();
  const savedList = allHackathons.filter((h) => ['saved', 'registered', 'building'].includes(itemStates[h.id]?.status));

  const catalogLines = allHackathons.slice(0, 50).map((h, idx) => {
    const regs = h.registrationsCount !== null ? `${h.registrationsCount} ĐK` : 'Chưa rõ ĐK';
    const flags = [
      h.isHiddenGem ? 'KÈO_THƠM' : '',
      h.isVietnam ? 'VIỆT_NAM' : '',
      h.hasTravelGrant ? 'TRAVEL_GRANT' : ''
    ].filter(Boolean).join(',');
    return `${idx + 1}. [${h.platform}] ${h.title} | Thưởng: ${h.prizeDisplay} | Hình thức: ${h.mode} (${h.location}) | Đối thủ: ${regs} | Hạn: ${h.deadline || h.dateText || 'Đang mở'} ${flags ? `| Nhãn: ${flags}` : ''} | Link: ${h.url}`;
  });

  let focusBlock = '';
  if (focusedHackathon) {
    focusBlock = `
=== GIẢI HACKATHON NGƯỜI DÙNG ĐANG GHIM PHÂN TÍCH ===
- Tên giải: ${focusedHackathon.title}
- Sàn: ${focusedHackathon.platform} | Đơn vị: ${focusedHackathon.organizer}
- Giải thưởng: ${focusedHackathon.prizeDisplay} | Địa điểm/Hình thức: ${focusedHackathon.location} (${focusedHackathon.mode})
- Số người đã đăng ký: ${focusedHackathon.registrationsCount ?? 'Chưa công bố'} | Hạn chót: ${focusedHackathon.deadline || focusedHackathon.dateText || 'Đang mở'}
- Link chính thức: ${focusedHackathon.url}
${pageDigest ? `- Nội dung trích xuất trực tiếp từ trang chủ giải đấu:\n"""\n${pageDigest}\n"""` : ''}
`;
  }

  const savedBlock = savedList.length
    ? `\n=== CÁC GIẢI NGƯỜI DÙNG ĐÃ LƯU / ĐANG THI (${savedList.length}) ===\n` +
      savedList.map((h) => `- ${h.title} (${h.prizeDisplay} · Trạng thái: ${itemStates[h.id]?.status})`).join('\n')
    : '';

  return `Bạn là **Radar AI**, cố vấn chiến lược săn giải Hackathon toàn cầu tích hợp trực tiếp bên trong ứng dụng Desktop "Global Hackathon Radar" của người dùng tại Việt Nam.
Thời gian hệ thống hiện tại: ${nowStr}.

NHIỆM VỤ CỦA BẠN:
1. Tư vấn chọn giải thông minh dựa trên dữ liệu thực tế đang mở (lọc đúng độ tuổi/đối tượng sinh viên hay người đi làm, Online từ Việt Nam hay Offline, tỷ lệ chọi thấp, quỹ thưởng cao).
2. Khi phân tích một giải cụ thể: kiểm tra kỹ điều kiện hợp lệ (độ tuổi, quốc gia, kích thước đội), tóm tắt tiêu chí chấm điểm / giải phụ (sponsor tracks) và đề xuất 2–3 ý tưởng dự án độc đáo, khả thi để code xong MVP trong 24–48 giờ dễ ăn giải nhất.
3. Trả lời bằng Tiếng Việt tự nhiên, súc tích, trình bày rõ ràng (dùng in đậm và gạch đầu dòng gọn gàng). Luôn kèm link đăng ký khi gợi ý giải.
${focusBlock}${savedBlock}

=== DANHÁCH ${catalogLines.length} GIẢI HACKATHON ĐANG MỞ TRÊN RADAR ===
${catalogLines.join('\n')}`;
}

function extractOutputTextFromInteraction(interaction) {
  if (typeof interaction?.output_text === 'string' && interaction.output_text.trim()) {
    return interaction.output_text.trim();
  }
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  const textParts = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st?.type === 'model_output' && Array.isArray(st.content)) {
      const stepTexts = st.content
        .filter((c) => c?.type === 'text' && c.text)
        .map((c) => c.text);
      textParts.unshift(...stepTexts);
    } else if (textParts.length > 0) {
      break;
    }
  }
  return textParts.join('').trim();
}

async function callInteractionsApi({ apiKey, model, systemPrompt, inputText, previousInteractionId }) {
  const payload = {
    model,
    system_instruction: systemPrompt,
    input: inputText
  };
  if (previousInteractionId) {
    payload.previous_interaction_id = previousInteractionId;
  }

  const res = await fetch('https://generativelanguage.googleapis.com/v1/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Revision': '2026-05-20',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini Interactions API HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reply = extractOutputTextFromInteraction(data);
  return {
    reply: reply || 'Mình chưa nhận được phản hồi văn bản từ mô hình, bạn thử hỏi lại nhé.',
    interactionId: data?.id || null
  };
}

export async function chatWithRadarAI({
  apiKey,
  model = 'gemini-4-hydrogen',
  messages = [],
  previousInteractionId = null,
  focusedHackathon = null,
  allHackathons = [],
  itemStates = {}
}) {
  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('Vui lòng nhập Gemini API Key để bắt đầu trò chuyện.');
  }

  // Upgrade any deprecated model strings automatically to gemini-4-hydrogen
  let activeModel = model;
  if (!activeModel || /^gemini-(1\.5|2\.0|2\.5)/i.test(activeModel)) {
    activeModel = 'gemini-4-hydrogen';
  }

  let pageDigest = '';
  if (focusedHackathon?.url) {
    pageDigest = await fetchHackathonPageDigest(focusedHackathon.url);
  }

  const systemPrompt = buildSystemInstruction({
    allHackathons,
    itemStates,
    focusedHackathon,
    pageDigest
  });

  // Latest user prompt (or compact transcript if no previous_interaction_id)
  const cleanMsgs = messages.filter((m) => m && m.text && String(m.text).trim());
  const lastUserMsg = cleanMsgs[cleanMsgs.length - 1]?.text || '';
  const inputText =
    previousInteractionId || cleanMsgs.length <= 1
      ? String(lastUserMsg)
      : cleanMsgs
          .slice(-10)
          .map((m) => `${m.role === 'user' ? 'Người dùng' : 'Radar AI'}: ${String(m.text).trim()}`)
          .join('\n\n');

  const fallbacks = [activeModel, 'gemini-4-hydrogen', 'gemini-3.5-flash-lite'].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );

  let lastErr = null;
  for (const candidateModel of fallbacks) {
    try {
      const out = await callInteractionsApi({
        apiKey: key,
        model: candidateModel,
        systemPrompt,
        inputText,
        previousInteractionId
      });
      return {
        reply: out.reply,
        interactionId: out.interactionId,
        modelUsed: candidateModel,
        fetchedPageContext: Boolean(pageDigest)
      };
    } catch (err) {
      lastErr = err;
      if (err.status !== 404 && err.status !== 429 && err.status !== 503) {
        break;
      }
    }
  }
  throw lastErr || new Error('Không thể kết nối tới Gemini Interactions API');
}

/* 轻盈计划 · AI 识别（拍照识别食物、语音转文字）
 * 使用智谱开放平台（open.bigmodel.cn）的接口，需要用户自己的 API Key。
 * Key 只保存在本机（不进备份码）；照片和录音会发送给智谱识别。
 */
'use strict';

const AI_KEY_STORE = 'qingying_ai_key';
const AI_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const AI_VISION_MODEL = 'glm-4v-flash'; // 智谱免费的识图模型
const AI_TEXT_MODEL = 'glm-4-flash'; // 免费文本模型，用于测试连接
const AI_ASR_MODEL = 'glm-asr'; // 语音转文字（按量计费，费用很低）
const MAX_RECORD_SEC = 30;
const ACTIONS_EXTRA = {}; // 由 app.js 合并进 ACTIONS

function aiKey() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; } }
function setAiKey(k) { try { k ? localStorage.setItem(AI_KEY_STORE, k) : localStorage.removeItem(AI_KEY_STORE); } catch (e) { /* 忽略 */ } }

async function aiFetch(path, init) {
  let res;
  try {
    res = await fetch(AI_BASE + path, Object.assign({}, init, {
      headers: Object.assign({ Authorization: 'Bearer ' + aiKey() }, init.headers || {})
    }));
  } catch (e) {
    throw new Error('连不上智谱服务器，请检查网络后重试');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `错误代码 ${res.status}`;
    if (res.status === 401) throw new Error('API Key 不正确或已失效，请到“计划 → 设置”重新填写');
    if (res.status === 429) throw new Error('请求太频繁或额度用完了：' + msg);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

function needKey() {
  openModal(`<h3>🤖 先开通 AI 识别</h3>
    <div class="note">拍照识别和语音识别需要用到智谱 AI（国内服务，识图模型免费）。只需设置一次：
      <ol>
        <li>手机浏览器打开 <b>open.bigmodel.cn</b>，用手机号注册登录</li>
        <li>点右上角头像 →“<b>API Key</b>”→“添加新的 API Key”，复制它</li>
        <li>回到轻盈计划：“<b>计划 → 设置 → AI 识别</b>”，粘贴保存</li>
      </ol></div>
    <div class="row" style="margin-top:12px">
      <button class="btn line grow" data-close>以后再说</button>
      <button class="btn grow" data-action="goAiSettings">去设置</button>
    </div>`);
}

/* ---------- 拍照识别 ---------- */
function compressImage(file, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('照片读取失败，请换一张试试')); };
    img.src = url;
  });
}

const PHOTO_PROMPT = `你是中国的注册营养师。请识别照片里的每一种食物，估算这一餐实际吃的可食用重量（克，不含骨头、壳、碗盘），并估算热量和蛋白质。
要求：用中国家常菜名；同一种食物合并；看不清也要给出最合理的估计；不要把餐具、饮料瓶等非食物算进去。
只返回 JSON，不要任何解释，格式：{"items":[{"name":"白米饭","grams":120,"kcal":139,"protein":3.1}]}
如果照片里没有食物，返回 {"items":[]}`;

function extractJson(text) {
  const s = String(text || '').replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AI 没有给出识别结果，请换个角度再拍一张');
  return JSON.parse(s.slice(a, b + 1));
}

async function recognizePhoto(dataUrl) {
  const call = (url) => aiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_VISION_MODEL,
      temperature: 0.2,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: PHOTO_PROMPT }] }]
    })
  });
  let data;
  try {
    data = await call(dataUrl.split(',')[1]); // 智谱文档写法：直接传 base64
  } catch (e) {
    if (e.status !== 400) throw e;
    data = await call(dataUrl); // 兼容带 data: 前缀的写法
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = extractJson(content);
  return (parsed.items || []).filter((it) => it && it.name && +it.grams > 0).map((it) => {
    const grams = Math.min(3000, Math.round(+it.grams));
    const f = matchFoodName(String(it.name));
    // 食物库里有的，用库里每100克的数据，保证和其他记录一致；没有的用 AI 估算值
    const per100 = f ? { k: f.k, p: f.p } : { k: (+it.kcal || 0) / grams * 100, p: (+it.protein || 0) / grams * 100 };
    return { name: String(it.name).slice(0, 20), grams, k: per100.k, p: per100.p, food: f ? f.name : '' };
  });
}

function matchFoodName(name) {
  const direct = findFood(name);
  if (direct) return direct;
  for (const [alias, real] of ALIAS_LIST) if (alias.length > 1 && (name === alias || name.includes(alias))) return findFood(real);
  return null;
}

let photoItems = [];
async function handlePhoto(file) {
  if (!file) return;
  let dataUrl;
  try { dataUrl = await compressImage(file); } catch (e) { toast(e.message); return; }
  openModal(`<h3>📷 正在识别…</h3>
    <img src="${dataUrl}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px">
    <p class="muted" style="text-align:center">AI 正在看照片里有什么，大约需要 5-15 秒</p>`);
  try {
    photoItems = await recognizePhoto(dataUrl);
  } catch (e) {
    openModal(`<h3>😅 识别没成功</h3><div class="note">${esc(e.message)}</div>
      <button class="btn block" data-close style="margin-top:12px">知道了</button>`);
    return;
  }
  if (!$('#modal') || $('#modal').hidden) return; // 用户已关掉弹窗
  if (!photoItems.length) {
    openModal(`<h3>🤔 没认出食物</h3><p class="muted">换个角度、离近一点、光线亮一点再拍试试，或者用“说一句话记餐”。</p>
      <button class="btn block" data-close>知道了</button>`);
    return;
  }
  renderPhotoReview(dataUrl);
}

function renderPhotoReview(dataUrl) {
  openModal(`<h3>📷 认出 ${photoItems.length} 样，请核对重量</h3>
    <img src="${dataUrl}" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:12px;margin-bottom:8px">
    <ul class="items">
      ${photoItems.map((it, i) => `<li>
        <label class="row grow" style="gap:6px"><input type="checkbox" data-photo-check="${i}" checked style="width:20px;height:20px;accent-color:var(--primary)">
          <span class="i-name">${esc(it.name)}</span></label>
        <input class="input" type="number" inputmode="decimal" min="1" max="3000" value="${it.grams}" data-photo-grams="${i}" style="width:76px;min-height:36px;padding:4px 8px">
        <span class="i-sub" style="width:58px;text-align:right" id="photoKcal${i}">${Math.round(it.k * it.grams / 100)}千卡</span>
      </li>`).join('')}
    </ul>
    <p class="muted small">重量单位：克（1两 = 50克）。AI 看照片估重量会有误差，吃了多少以你为准；油大的菜热量会更高。</p>
    <div class="row" style="margin-top:8px">
      <button class="btn line grow" data-close>取消</button>
      <button class="btn grow" data-action="photoAdd">加入待记入</button>
    </div>`);
}

/* ---------- 录音 + 语音转文字 ---------- */
let recorder = null, recordTimer = 0, recordStart = 0;
async function startRecording() {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    toast('这个浏览器不能录音，请用输入法的话筒'); return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
    openModal(`<h3>🎤 没有麦克风权限</h3><div class="note">请允许浏览器使用麦克风：<br>浏览器菜单 → 设置 → 网站设置（或“权限管理”）→ 麦克风 → 允许本网站。<br>也可以手机“设置 → 应用 → 浏览器 → 权限 → 麦克风”。</div>
      <button class="btn block" data-close style="margin-top:12px">知道了</button>`);
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    clearInterval(recordTimer);
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    setVoiceBtn('⏳ 识别中…');
    try {
      const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
      if (Date.now() - recordStart < 800 || !blob.size) throw new Error('说话时间太短了，请按一下开始、说完再按一下');
      const wav = await toWav16k(blob);
      const text = await transcribe(wav);
      if (!text) throw new Error('没听清，请靠近手机再说一次');
      const box = $('#sayText');
      if (box) { box.value = (box.value ? box.value + '，' : '') + text; ACTIONS.sayParse(); }
    } catch (e) {
      toast(e.message || '语音识别失败');
    } finally {
      setVoiceBtn('🎤 按我说话');
    }
  };
  recorder.start();
  recordStart = Date.now();
  const tick = () => {
    const sec = Math.floor((Date.now() - recordStart) / 1000);
    setVoiceBtn(`⏹ 说完点我（${MAX_RECORD_SEC - sec}秒）`);
    if (sec >= MAX_RECORD_SEC && recorder) recorder.stop();
  };
  tick();
  recordTimer = setInterval(tick, 500);
  toast('开始录音，请说吃了什么');
}
function setVoiceBtn(text) { const b = $('#voiceBtn'); if (b) b.textContent = text; }

/* 智谱语音识别只收 wav/mp3：把录音转成 16kHz 单声道 wav */
async function toWav16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let buf;
  try { buf = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { if (ctx.close) ctx.close(); }
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
async function transcribe(wav) {
  const fd = new FormData();
  fd.append('model', AI_ASR_MODEL);
  fd.append('stream', 'false');
  fd.append('file', wav, 'voice.wav');
  const data = await aiFetch('/audio/transcriptions', { method: 'POST', body: fd });
  return String((data && data.text) || '').trim();
}

async function testAiKey() {
  const data = await aiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_TEXT_MODEL, messages: [{ role: 'user', content: '只回复两个字：成功' }], max_tokens: 10 })
  });
  return !!(data && data.choices);
}

function aiSettingsCard() {
  const k = aiKey();
  return `<div class="card" id="aiSettings">
    <h2>🤖 AI 识别（拍照 / 语音）</h2>
    <p class="muted small" style="margin-top:-4px">拍照识别食物、语音说话记餐需要智谱 AI 的 API Key。识图用免费模型；语音识别按量收费，每次约几分钱。Key 只存在这部手机里，不会进备份码。照片和录音会发给智谱识别。</p>
    ${k ? `<div class="note">✅ 已设置 API Key（${esc(k.slice(0, 6))}…${esc(k.slice(-4))}）</div>` : `<div class="note">
      <b>获取方法：</b>
      <ol><li>浏览器打开 <b>open.bigmodel.cn</b>，手机号注册登录</li><li>右上角头像 →“API Key”→“添加新的 API Key”→ 复制</li><li>粘贴到下面，点“保存并测试”</li></ol></div>`}
    <label class="field" style="margin-top:10px">API Key
      <input class="input" id="aiKeyInput" type="password" autocomplete="off" placeholder="${k ? '如需更换，粘贴新的 Key' : '粘贴智谱 API Key'}">
    </label>
    <div class="row" style="margin-top:8px">
      <button class="btn grow" data-action="aiSave">保存并测试</button>
      ${k ? '<button class="btn line" data-action="aiClear">删除</button>' : ''}
    </div>
  </div>`;
}

Object.assign(ACTIONS_EXTRA, {
  photo() {
    if (!aiKey()) { needKey(); return; }
    $('#photoInput').click();
  },
  photoAdd() {
    let n = 0;
    photoItems.forEach((it, i) => {
      const box = document.querySelector(`[data-photo-check="${i}"]`);
      const g = Math.round(+document.querySelector(`[data-photo-grams="${i}"]`).value);
      if (!box || !box.checked || !(g > 0)) return;
      const kcal = Math.round(it.k * g / 100);
      logState.basket.push({ name: it.food || it.name, portion: gramsLabel(g) + ' · 拍照估算', grams: g, kcal, protein: round1(it.p * g / 100), photo: true });
      n++;
    });
    closeModal();
    toast(n ? `已加入 ${n} 样，核对后点底部“记入”` : '没有选中任何食物');
    renderBasket(); renderFab();
  },
  goAiSettings() {
    closeModal(); planTab = 'settings'; go('plan');
    setTimeout(() => { const c = $('#aiSettings'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  },
  async aiSave(el) {
    const v = $('#aiKeyInput').value.trim();
    if (!v) { toast(aiKey() ? '没有改动' : '请先粘贴 API Key'); return; }
    const old = aiKey();
    setAiKey(v);
    el.disabled = true; el.textContent = '测试中…';
    try {
      await testAiKey();
      toast('✅ 连接成功，可以拍照和语音识别了');
      renderPlan();
    } catch (e) {
      setAiKey(old);
      el.disabled = false; el.textContent = '保存并测试';
      toast('❌ ' + e.message);
    }
  },
  aiClear() {
    if (!confirm('删除已保存的 API Key？')) return;
    setAiKey(''); renderPlan(); toast('已删除');
  }
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  CircleDot,
  Eraser,
  Gauge,
  KeyRound,
  MessageSquareText,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  X,
  Zap
} from 'lucide-react';
import { analyzeMessage, fetchApiConfig, fetchFrameworks, saveApiConfig, searchKnowledge } from './lib/api';
import HoloTilt from './components/HoloTilt';
import Lightfall from './components/Lightfall';
import './styles.css';

const fallbackAnalysis = {
  signal: { level: 'medium', label: '等待判断' },
  scenario: '聊天',
  contextInsight: {
    trend: '不确定',
    summary: '粘贴消息以后，会结合当前消息、手动背景和最近对话一起判断。',
    basis: ['当前还没有输入消息']
  },
  commentary: '说实话兄弟们，先别急着上头。消息进来以后，先判断她有没有投入，再决定你该接住还是收一收。',
  goodPoints: [],
  warnPoints: [],
  suggestions: [],
  bookKnowledge: [],
  ai: { provider: 'idle' }
};

function scoreFor(level) {
  if (level === 'strong') return 86;
  if (level === 'weak') return 24;
  return 58;
}

function signalText(level) {
  if (level === 'strong') return '强信号';
  if (level === 'weak') return '弱信号';
  return '中等信号';
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function compactText(value, limit = 520) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function guessMessageType(speaker, ownName, otherName) {
  const value = String(speaker || '').trim();
  const normalized = value.toLowerCase();
  const mine = String(ownName || '').trim().toLowerCase();
  const other = String(otherName || '').trim().toLowerCase();

  if (!value) return 'her';
  if (['我', '本人', '自己', 'me', 'self'].includes(normalized)) return 'me';
  if (mine && (normalized === mine || normalized.includes(mine))) return 'me';
  if (['她', '他', 'ta', '对方', '女生', '男生', '好友'].includes(normalized)) return 'her';
  if (other && (normalized === other || normalized.includes(other))) return 'her';
  return 'her';
}

function normalizeWechatLine(line) {
  return String(line || '')
    .replace(/\u200b/g, '')
    .replace(/^\s*[|｜]\s*/, '')
    .trim();
}

function shouldSkipImportLine(line) {
  return !line ||
    /^-{2,}$/.test(line) ||
    /^=+$/.test(line) ||
    /^(以下为|以上为|微信聊天记录|聊天记录|消息记录)/.test(line);
}

function tryParseJsonChat(raw, ownName, otherName) {
  const text = raw.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return [];

  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.messages || data.records || data.chat || []);
    if (!Array.isArray(list)) return [];

    return list
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const speaker = item.sender || item.speaker || item.from || item.name || item.role || '';
        const content = item.text || item.content || item.message || item.msg || '';
        const recordText = compactText(content);
        if (!recordText) return null;
        return {
          type: guessMessageType(speaker, ownName, otherName),
          speaker: String(speaker || ''),
          text: recordText,
          time: String(item.time || item.createdAt || item.date || '')
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseWechatText(raw, ownName = '我', otherName = '她') {
  const jsonRecords = tryParseJsonChat(raw, ownName, otherName);
  if (jsonRecords.length) return jsonRecords;

  const records = [];
  let current = null;
  let pendingTime = '';

  const pushCurrent = () => {
    if (!current) return;
    const text = compactText(current.text);
    if (text) records.push({ ...current, text });
    current = null;
  };

  String(raw || '').split(/\r?\n/).forEach((sourceLine) => {
    const line = normalizeWechatLine(sourceLine);
    if (shouldSkipImportLine(line)) return;

    const timeOnly = line.match(/^(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (timeOnly) {
      pendingTime = timeOnly[1];
      return;
    }

    const speakerTime = line.match(/^(.{1,28}?)\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (speakerTime) {
      pushCurrent();
      current = {
        type: guessMessageType(speakerTime[1], ownName, otherName),
        speaker: speakerTime[1].trim(),
        text: '',
        time: speakerTime[2]
      };
      pendingTime = '';
      return;
    }

    const bracketLine = line.match(/^\[?(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^：:]{1,28})[：:]\s*(.*)$/);
    if (bracketLine) {
      pushCurrent();
      current = {
        type: guessMessageType(bracketLine[2], ownName, otherName),
        speaker: bracketLine[2].trim(),
        text: bracketLine[3],
        time: bracketLine[1]
      };
      return;
    }

    const colonLine = line.match(/^([^：:]{1,28})[：:]\s*(.*)$/);
    if (colonLine && !/^https?:\/\//i.test(line)) {
      pushCurrent();
      current = {
        type: guessMessageType(colonLine[1], ownName, otherName),
        speaker: colonLine[1].trim(),
        text: colonLine[2],
        time: pendingTime
      };
      pendingTime = '';
      return;
    }

    if (!current) {
      current = {
        type: 'her',
        speaker: otherName || '对方',
        text: line,
        time: pendingTime
      };
      pendingTime = '';
      return;
    }

    current.text = `${current.text}\n${line}`.trim();
  });

  pushCurrent();
  return records;
}

function recordsToContext(records) {
  return records.map((record) => ({
    source: 'wechat-import',
    time: record.time || '',
    her: record.type === 'her' ? record.text : undefined,
    my: record.type === 'me' ? record.text : undefined
  }));
}

function buildWechatImportSummary(records, otherName = '对方') {
  const meCount = records.filter((item) => item.type === 'me').length;
  const herCount = records.length - meCount;
  const firstTime = records.find((item) => item.time)?.time || '未识别';
  const lastTime = [...records].reverse().find((item) => item.time)?.time || '未识别';
  const recent = records
    .slice(-18)
    .map((item) => `${item.type === 'me' ? '我' : otherName || '对方'}：${item.text}`)
    .join('\n');

  return [
    `已导入微信聊天记录：共 ${records.length} 条；我方 ${meCount} 条，对方 ${herCount} 条；时间范围 ${firstTime} 至 ${lastTime}。`,
    '分析时请把这些历史当成真实上下文，重点看最近互动趋势、谁主动开启话题、谁在持续投入。',
    `最近聊天片段：\n${recent}`
  ].join('\n');
}

function SignalCanvas({ score = 58 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0c0b';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 18; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, h - 12);
      ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#d95645');
    gradient.addColorStop(0.55, '#f0b35c');
    gradient.addColorStop(1, '#35b779');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 9; i += 1) {
      const px = 16 + i * ((w - 32) / 8);
      const amp = (score / 100) * 22;
      const py = h / 2 + Math.sin(i * 1.1 + score / 18) * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = '#fff4df';
    ctx.beginPath();
    ctx.arc(w - 22, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }, [score]);

  return <canvas className="signal-canvas" ref={ref} width="224" height="96" aria-hidden="true" />;
}

function Header({ onFrameworks, onSearch, onClear, onApiSettings, onImportChat, score, apiConfig }) {
  const activeProvider = apiConfig?.providers?.[apiConfig.activeProvider];
  const providerLabel = activeProvider?.label || apiConfig?.activeProvider || 'API';
  const providerReady = Boolean(activeProvider?.hasKey);

  return (
    <header className="app-header">
      <div className="brand-graph">
        <SignalCanvas score={score} />
      </div>
      <div className="brand-mark">景</div>
      <div className="brand-copy">
        <p>Tong Jincheng Perspective</p>
        <h1>深情祖师爷 · 信号分析台</h1>
        <span>先看投入，再看台阶，最后决定怎么接。</span>
      </div>
      <nav className="header-actions" aria-label="工具">
        <button
          type="button"
          className={`api-pill ${providerReady ? 'ready' : ''}`}
          onClick={onApiSettings}
          title="切换模型 API"
        >
          <KeyRound size={14} />
          <span>{providerLabel}</span>
          <em>{providerReady ? '已连接' : '未填 Key'}</em>
        </button>
        <button type="button" className="icon-button" onClick={onSearch} title="搜索知识库">
          <Search size={16} />
        </button>
        <button type="button" className="ghost-button" onClick={onImportChat}>
          <Upload size={15} />
          导入微信
        </button>
        <button type="button" className="ghost-button" onClick={onFrameworks}>
          <BookOpen size={15} />
          框架
        </button>
        <button type="button" className="ghost-button" onClick={onClear}>
          <Eraser size={15} />
          清空
        </button>
      </nav>
    </header>
  );
}

function EmptyDashboard() {
  return (
    <HoloTilt
      className="empty-dashboard holo-dashboard"
      glowColor="rgba(240, 179, 92, 0.42)"
      innerGradient="linear-gradient(145deg, rgba(217,86,69,0.11), rgba(53,183,121,0.08) 52%, rgba(104,129,242,0.1))"
    >
      <section className="empty-dashboard-inner">
        <div className="empty-main">
          <span className="status-chip">READY</span>
          <h2>判断关系，不靠脑补，靠信号。</h2>
          <p>真诚不是把自己交出去，而是清醒地表达。对方有没有投入、有没有台阶、有没有继续聊的意愿，先拆开看。</p>
          <div className="principles">
            <div><b>吸引</b><span>先看她有没有靠近你的理由。</span></div>
            <div><b>台阶</b><span>让她有体面回应的空间。</span></div>
            <div><b>边界</b><span>不测试，也不把情绪全押上。</span></div>
          </div>
        </div>
        <div className="calibration-card">
          <h3>判断顺序</h3>
          {[
            ['投入', 74],
            ['语气', 58],
            ['前文', 88],
            ['动作', 46]
          ].map(([label, value], index) => (
            <div className="calibration-row" key={label}>
              <span>{label}</span>
              <div className="calibration-bar"><i style={{ width: `${value}%` }} /></div>
              <b>{String(index + 1).padStart(2, '0')}</b>
            </div>
          ))}
        </div>
      </section>
    </HoloTilt>
  );
}

function ChatPanel({ messages }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <main className="chat-panel" ref={listRef}>
      {messages.length === 0 ? <EmptyDashboard /> : (
        <div className="message-stack">
          {messages.map((message) => (
            <div className={`message-row ${message.type}`} key={message.id}>
              <div className="avatar">{message.type === 'her' ? '她' : '你'}</div>
              <div className="bubble-wrap">
                <div className="bubble">{message.text}</div>
                <time>{message.time}</time>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Composer({ onSubmit, disabled }) {
  const [message, setMessage] = useState('');
  const [background, setBackground] = useState('');
  const [open, setOpen] = useState(false);

  const submit = () => {
    const value = message.trim();
    if (!value || disabled) return;
    onSubmit({ message: value, background: background.trim() });
    setMessage('');
  };

  return (
    <footer className="composer-panel">
      <section className={`context-panel ${open ? 'open' : ''}`}>
        <button type="button" className="context-toggle" onClick={() => setOpen(!open)}>
          <span>补充上下文 / 关系背景</span>
          <em>前文越清楚，判断越准</em>
          <ChevronDown size={16} />
        </button>
        {open && (
          <textarea
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            placeholder="可选：把前几轮聊天、你们关系、最近发生的事贴这里。比如：我们刚认识三天；她昨天主动约过我；刚才我回得有点冷..."
          />
        )}
      </section>

      <div className="composer-row">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="粘贴她的消息..."
        />
        <button type="button" className="send-button" onClick={submit} disabled={disabled || !message.trim()}>
          <Send size={17} />
          {disabled ? '分析中' : '分析'}
        </button>
      </div>

      <div className="composer-tags">
        <span>吸引 &gt; 讨好</span>
        <span>给台阶</span>
        <span>不考验人性</span>
      </div>
    </footer>
  );
}

const providerDefaults = {
  deepseek: {
    label: 'DeepSeek',
    model: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/chat/completions'
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-5.5',
    baseUrl: 'https://api.openai.com/v1/responses'
  }
};

function ApiSettingsModal({ open, config, onClose, onSaved }) {
  const [provider, setProvider] = useState('deepseek');
  const [model, setModel] = useState(providerDefaults.deepseek.model);
  const [baseUrl, setBaseUrl] = useState(providerDefaults.deepseek.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    const active = config?.activeProvider || 'deepseek';
    const providerConfig = config?.providers?.[active];
    const fallback = providerDefaults[active] || providerDefaults.deepseek;
    setProvider(active);
    setModel(providerConfig?.model || fallback.model);
    setBaseUrl(providerConfig?.baseUrl || fallback.baseUrl);
    setApiKey('');
    setStatus('');
  }, [open, config]);

  useEffect(() => {
    const providerConfig = config?.providers?.[provider];
    const fallback = providerDefaults[provider] || providerDefaults.deepseek;
    setModel(providerConfig?.model || fallback.model);
    setBaseUrl(providerConfig?.baseUrl || fallback.baseUrl);
    setApiKey('');
  }, [provider]);

  if (!open) return null;

  const activeConfig = config?.providers?.[provider];
  const hasKey = Boolean(activeConfig?.hasKey);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');

    try {
      const nextConfig = await saveApiConfig({
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim()
      });
      onSaved(nextConfig);
      setStatus('已保存，下一次分析会使用这套配置。');
      setApiKey('');
    } catch (error) {
      setStatus(`保存失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="API 设置">
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="关闭 API 设置" />
      <form className="api-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>Runtime API</p>
            <h2>切换模型接口</h2>
            <span>Key 只保存在当前后端进程内，不写进项目文件。</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <ChevronDown size={16} />
          </button>
        </div>

        <div className="provider-tabs" role="tablist" aria-label="Provider">
          {Object.entries(providerDefaults).map(([name, item]) => (
            <button
              type="button"
              role="tab"
              aria-selected={provider === name}
              className={provider === name ? 'active' : ''}
              key={name}
              onClick={() => setProvider(name)}
            >
              <Sparkles size={14} />
              {item.label}
            </button>
          ))}
        </div>

        <label className="field-row">
          <span>模型</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={providerDefaults[provider]?.model}
          />
        </label>

        <label className="field-row">
          <span>Endpoint</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={providerDefaults[provider]?.baseUrl}
          />
        </label>

        <label className="field-row">
          <span>API Key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder={hasKey ? '已保存 Key；不填则沿用当前 Key' : '粘贴 API Key'}
            autoComplete="off"
          />
        </label>

        <div className={`key-state ${hasKey ? 'ready' : ''}`}>
          <ShieldCheck size={15} />
          {hasKey ? '当前 provider 已有 Key' : '当前 provider 还没有 Key，未填写会走本地兜底'}
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="submit" className="send-button" disabled={saving}>
            <Settings2 size={16} />
            {saving ? '保存中' : '保存并切换'}
          </button>
        </div>

        {status && <p className="save-status">{status}</p>}
      </form>
    </div>
  );
}

function WechatImportModal({ open, onClose, onImport }) {
  const [rawText, setRawText] = useState('');
  const [ownName, setOwnName] = useState('我');
  const [otherName, setOtherName] = useState('对方');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (!open) return;
    setFileName('');
  }, [open]);

  const records = useMemo(() => parseWechatText(rawText, ownName, otherName), [rawText, ownName, otherName]);
  const meCount = records.filter((item) => item.type === 'me').length;
  const herCount = records.length - meCount;

  if (!open) return null;

  const readFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setRawText(text);
    event.target.value = '';
  };

  const submit = (event) => {
    event.preventDefault();
    if (!records.length) return;
    onImport({ records, ownName, otherName, replaceExisting });
    setRawText('');
    setFileName('');
    onClose();
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="导入微信聊天记录">
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="关闭导入" />
      <form className="import-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>WeChat Context</p>
            <h2>导入微信聊天记录</h2>
            <span>支持粘贴聊天文本，或上传 txt/csv/json/html 文件；只在浏览器内解析，不上传文件本身。</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="import-grid">
          <section className="import-editor">
            <div className="import-controls">
              <label>
                <span>你的昵称</span>
                <input value={ownName} onChange={(event) => setOwnName(event.target.value)} placeholder="我" />
              </label>
              <label>
                <span>对方昵称</span>
                <input value={otherName} onChange={(event) => setOtherName(event.target.value)} placeholder="对方" />
              </label>
            </div>

            <label className="upload-drop">
              <Upload size={17} />
              <strong>{fileName || '选择聊天文件'}</strong>
              <span>txt / csv / json / html</span>
              <input type="file" accept=".txt,.csv,.json,.html,.htm,text/*,application/json" onChange={readFile} />
            </label>

            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder={'也可以直接粘贴，例如：\n我：刚到家了\n对方：辛苦啦，今天还挺开心的\n2026-06-22 23:12 对方：下次再约'}
            />

            <label className="check-row">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              <span>导入后替换当前聊天，而不是追加</span>
            </label>
          </section>

          <section className="import-preview">
            <div className="import-stats">
              <div><b>{records.length}</b><span>识别消息</span></div>
              <div><b>{herCount}</b><span>{otherName || '对方'}</span></div>
              <div><b>{meCount}</b><span>我</span></div>
            </div>

            <div className="preview-list">
              {records.length === 0 ? (
                <p className="preview-empty">粘贴聊天内容后，这里会预览识别出的最近消息。</p>
              ) : records.slice(-8).map((record, index) => (
                <article className={`preview-message ${record.type}`} key={`${record.text}-${index}`}>
                  <span>{record.type === 'me' ? '我' : otherName || '对方'}</span>
                  <p>{record.text}</p>
                  {record.time && <em>{record.time}</em>}
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="submit" className="send-button" disabled={!records.length}>
            <Upload size={16} />
            导入上下文
          </button>
        </div>
      </form>
    </div>
  );
}

function AiBadge({ ai }) {
  if (ai?.provider === 'deepseek') {
    return <span className="ai-badge deepseek"><Sparkles size={12} />DeepSeek 增强</span>;
  }
  if (ai?.provider === 'openai') {
    return <span className="ai-badge openai"><Sparkles size={12} />OpenAI 增强</span>;
  }
  if (ai?.provider === 'idle') {
    return <span className="ai-badge idle"><CircleDot size={12} />Standby</span>;
  }
  if (ai?.provider === 'imported') {
    return <span className="ai-badge imported"><Upload size={12} />已导入上下文</span>;
  }
  if (ai?.selectedProvider) {
    return <span className="ai-badge local"><CircleDot size={12} />{ai.selectedProvider} 未接通</span>;
  }
  return <span className="ai-badge local"><CircleDot size={12} />本地兜底</span>;
}

function SignalCard({ analysis }) {
  const level = analysis.signal?.level || 'medium';
  const score = scoreFor(level);

  return (
    <section className={`panel-card signal-${level}`}>
      <div className="card-head">
        <h3><Gauge size={16} />信号强度</h3>
        <div className="card-badges">
          <AiBadge ai={analysis.ai} />
          <span className={`signal-badge ${level}`}>{analysis.signal?.label || signalText(level)}</span>
        </div>
      </div>
      <div className="signal-body">
        <div className="score-ring" style={{ '--score': `${score}%` }}>
          <strong>{score}</strong>
        </div>
        <div>
          <h4>{analysis.scenario || '聊天'}</h4>
          <p>这条消息的重点不是字数本身，而是投入、提问、情绪，以及是否给你继续推进的入口。</p>
        </div>
      </div>
    </section>
  );
}

function ActionDecisionCard({ decision, analysis }) {
  if (!decision) return null;
  const action = decision.action || '观察';
  const level = analysis.signal?.level || 'medium';
  const actionClass = action === '推进' ? 'advance' :
    action === '收住' || action === '暂停' ? 'hold' :
      action === '共情' ? 'empathy' : 'catch';

  return (
    <section className={`panel-card decision-card ${actionClass}`}>
      <div className="decision-orbit">
        <span>{action}</span>
      </div>
      <div className="decision-copy">
        <div className="decision-kicker">
          <TrendingUp size={14} />
          <span>{decision.mode || '稳妥'}模式</span>
          <em>{decision.confidence || '中'}置信</em>
        </div>
        <h3>{decision.headline || `${action}，别急`}</h3>
        <p>{decision.why || '先看投入和上下文，再决定回复强度。'}</p>
        <div className="decision-steps">
          <span><b>下一步</b>{decision.nextStep || '发一条短句，观察她是否继续投入。'}</span>
          <span><b>别做</b>{decision.dont || '不要连发、施压或过度解释。'}</span>
        </div>
        <div className="decision-foot">
          <span className={`signal-badge ${level}`}>{analysis.signal?.label || signalText(level)}</span>
        </div>
      </div>
    </section>
  );
}

function ContextCard({ insight }) {
  if (!insight) return null;
  return (
    <section className="panel-card">
      <div className="card-head">
        <h3><Target size={16} />上下文判断</h3>
      </div>
      <div className="context-result">
        <div className="trend-line">
          <span className="trend-badge">{insight.trend || '不确定'}</span>
          <p>{insight.summary || '上下文不足，主要依据当前消息。'}</p>
        </div>
        {insight.basis?.length > 0 && (
          <div className="evidence-list">
            {insight.basis.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

function CommentaryCard({ analysis }) {
  return (
    <section className="panel-card">
      <div className="card-head">
        <h3><Brain size={16} />景辰判断</h3>
      </div>
      <p className="commentary">{analysis.commentary}</p>
    </section>
  );
}

function BreakdownCard({ good = [], warns = [] }) {
  if (!good.length && !warns.length) return null;
  return (
    <section className="panel-card">
      <div className="card-head">
        <h3><Activity size={16} />信号拆解</h3>
      </div>
      <div className="breakdown-list">
        {good.map((item, index) => <div className="breakdown good" key={`g-${index}`}><Check size={14} />{item}</div>)}
        {warns.map((item, index) => <div className="breakdown warn" key={`w-${index}`}><Zap size={14} />{item}</div>)}
      </div>
    </section>
  );
}

function Suggestions({ suggestions = [], onUse }) {
  if (!suggestions.length) return null;
  return (
    <section className="suggestion-section">
      <div className="section-label">回复建议</div>
      {suggestions.map((suggestion, index) => (
        <article className="suggestion-card" key={`${suggestion.tag}-${index}`}>
          <div className="suggestion-top">
            <span>方案 {index + 1} · {suggestion.tag}</span>
            {suggestion.source && <em>{suggestion.source}</em>}
          </div>
          <div className="suggestion-meta">
            {suggestion.mode && <i className={`mode-${suggestion.mode}`}>{suggestion.mode}</i>}
            {suggestion.intent && <i>{suggestion.intent}</i>}
            {suggestion.principle && <i>{suggestion.principle}</i>}
          </div>
          <blockquote>{suggestion.example}</blockquote>
          <p>{suggestion.reason}</p>
          {suggestion.contextBasis?.length > 0 && (
            <div className="suggestion-basis">
              <b>上下文依据</b>
              {suggestion.contextBasis.map((item, basisIndex) => (
                <span key={`${item}-${basisIndex}`}>{item}</span>
              ))}
            </div>
          )}
          {suggestion.risk && <div className="suggestion-risk">{suggestion.risk}</div>}
          <button type="button" onClick={() => onUse(suggestion.example)}>采用</button>
        </article>
      ))}
    </section>
  );
}

function KnowledgeCard({ items = [] }) {
  if (!items.length) return null;
  return (
    <section className="panel-card knowledge-card">
      <div className="card-head">
        <h3><BookOpen size={16} />知识库匹配</h3>
        <span className="count-badge">{items.length} 条</span>
      </div>
      <div className="knowledge-list">
        {items.slice(0, 6).map((item, index) => (
          <div className="knowledge-item" key={`${item.source}-${index}`}>
            <span>{item.type === 'advice' ? '建议' : item.type === 'framework' ? '框架' : '原则'}</span>
            <div>
              <p>{item.text}</p>
              <em>{item.source}</em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplyGate({ draft, onDraftChange, onSend }) {
  const issues = useMemo(() => {
    const text = draft.trim();
    if (!text) return [];
    const result = [];
    if (text.length > 180) result.push({ level: 'warn', text: '回复偏长，精简一下。聊天不是写作文。' });
    if ((text.match(/我/g) || []).length > 5) result.push({ level: 'warn', text: '“我”太多了，给她一点表达空间。' });
    if (['求你了', '好不好嘛', '求求', '拜托'].some((word) => text.includes(word))) result.push({ level: 'fail', text: '讨好感太重，重写。真诚不是低姿态。' });
    return result;
  }, [draft]);

  return (
    <section className="panel-card reply-card">
      <div className="card-head">
        <h3><MessageSquareText size={16} />你的回复 · 把关</h3>
      </div>
      <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="输入你打算回复的内容..." />
      <div className="reply-actions">
        <button type="button" onClick={() => onSend(draft)} disabled={!draft.trim() || issues.some((issue) => issue.level === 'fail')}>把关并发送</button>
        <button type="button" onClick={() => onDraftChange('')}>清空</button>
      </div>
      {draft.trim() && (
        <div className="gate-results">
          {issues.length === 0 ? <span className="pass">看着还行，发吧。真诚才是最高级的套路。</span> :
            issues.map((issue) => <span className={issue.level} key={issue.text}>{issue.text}</span>)}
        </div>
      )}
    </section>
  );
}

function WaitingPanel() {
  return (
    <section className="panel-card waiting-card">
      <div className="card-head">
        <h3><CircleDot size={16} />等待消息</h3>
        <span className="count-badge">Standby</span>
      </div>
      <p className="commentary">说实话兄弟们，先别急着上头。消息进来以后，咱先判断她有没有投入，再决定你该接住还是收一收。</p>
      <div className="waiting-metrics">
        <div><b>信号</b><span>字数、提问、情绪</span></div>
        <div><b>上下文</b><span>升温还是降温</span></div>
        <div><b>动作</b><span>接住、推进、收住</span></div>
      </div>
    </section>
  );
}

function AnalysisPanel({ analysis, loading, draft, onDraftChange, onSendReply, onUseSuggestion }) {
  const handleCardGlow = (event) => {
    const card = event.target.closest('.panel-card, .suggestion-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const kx = dx === 0 ? Infinity : cx / Math.abs(dx);
    const ky = dy === 0 ? Infinity : cy / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  };

  return (
    <aside className="analysis-panel">
      <div className="analysis-header">
        <div>
          <p>Live Read</p>
          <h2>实时判断</h2>
          <span>信号强度 · 景辰点评 · 回复把关</span>
        </div>
        <button type="button" className="icon-button" title="搜索知识库"><Search size={16} /></button>
      </div>
      <div className="analysis-scroll" onPointerMove={handleCardGlow}>
        {loading ? <LoadingCards /> : analysis.ai?.provider === 'idle' ? <WaitingPanel /> : (
          <>
            {analysis.ai?.provider !== 'imported' && <ActionDecisionCard decision={analysis.actionDecision} analysis={analysis} />}
            {analysis.ai?.provider !== 'imported' && <SignalCard analysis={analysis} />}
            <ContextCard insight={analysis.contextInsight} />
            <CommentaryCard analysis={analysis} />
            {analysis.ai?.provider !== 'imported' && <BreakdownCard good={analysis.goodPoints} warns={analysis.warnPoints} />}
            {analysis.ai?.provider !== 'imported' && <Suggestions suggestions={analysis.suggestions} onUse={onUseSuggestion} />}
            {analysis.ai?.provider !== 'imported' && <KnowledgeCard items={analysis.bookKnowledge} />}
            <ReplyGate draft={draft} onDraftChange={onDraftChange} onSend={onSendReply} />
          </>
        )}
      </div>
    </aside>
  );
}

function LoadingCards() {
  return (
    <div className="loading-stack">
      {Array.from({ length: 4 }).map((_, index) => <div className="panel-card skeleton-card" key={index} />)}
    </div>
  );
}

function App() {
  const [messages, setMessages] = useState([]);
  const [context, setContext] = useState([]);
  const [importSummary, setImportSummary] = useState('');
  const [analysis, setAnalysis] = useState(fallbackAnalysis);
  const [loading, setLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [apiConfig, setApiConfig] = useState(null);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [wechatImportOpen, setWechatImportOpen] = useState(false);

  const score = scoreFor(analysis.signal?.level);

  useEffect(() => {
    fetchApiConfig()
      .then(setApiConfig)
      .catch(() => {
        setApiConfig({
          activeProvider: 'deepseek',
          providers: {
            deepseek: { label: 'DeepSeek', model: 'deepseek-v4-flash', hasKey: false },
            openai: { label: 'OpenAI', model: 'gpt-5.5', hasKey: false }
          }
        });
      });
  }, []);

  const handleAnalyze = async ({ message, background }) => {
    const herMessage = { id: crypto.randomUUID(), type: 'her', text: message, time: nowTime() };
    const mergedBackground = [importSummary, background].filter(Boolean).join('\n\n');
    setMessages((current) => [...current, herMessage]);
    setLoading(true);

    try {
      const data = await analyzeMessage({ message, background: mergedBackground, context });
      setAnalysis(data);
      setContext((current) => [...current, {
        her: message,
        background: mergedBackground,
        analysis: {
          signal: data.signal,
          scenario: data.scenario,
          contextTrend: data.contextInsight?.trend,
          contextSummary: data.contextInsight?.summary,
          action: data.actionDecision?.action,
          actionMode: data.actionDecision?.mode,
          replyIntent: data.suggestions?.[0]?.intent,
          replyPrinciple: data.suggestions?.[0]?.principle
        }
      }]);
    } catch (error) {
      setAnalysis({
        ...fallbackAnalysis,
        ai: { provider: 'local', reason: error.message },
        commentary: '服务器连接失败，先别急。检查后端是否还在 8765 端口运行。'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendReply = (reply) => {
    const value = reply.trim();
    if (!value) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), type: 'me', text: value, time: nowTime() }]);
    setContext((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last) {
        last.my = value;
        last.myLength = value.length;
      }
      return next;
    });
    setReplyDraft('');
  };

  const handleWechatImport = ({ records, otherName, replaceExisting }) => {
    const importedMessages = records.map((record) => ({
      id: crypto.randomUUID(),
      type: record.type,
      text: record.text,
      time: record.time || nowTime(),
      imported: true
    }));
    const importedContext = recordsToContext(records);
    const summary = buildWechatImportSummary(records, otherName);

    setMessages((current) => replaceExisting ? importedMessages : [...current, ...importedMessages]);
    setContext((current) => replaceExisting ? importedContext : [...current, ...importedContext]);
    setImportSummary((current) => replaceExisting || !current ? summary : `${current}\n\n${summary}`);
    setAnalysis({
      ...fallbackAnalysis,
      contextInsight: {
        trend: '已导入',
        summary: `已导入 ${records.length} 条微信聊天记录。下一次分析会结合这些历史上下文，不再只看最后一句。`,
        basis: [
          `对方消息 ${records.filter((item) => item.type === 'her').length} 条`,
          `你的消息 ${records.filter((item) => item.type === 'me').length} 条`,
          '最近聊天片段会作为背景传给分析模型'
        ]
      },
      commentary: '聊天记录已经接进来了。接下来粘贴她最新那句话，我会结合导入的历史一起判断趋势和回复强度。',
      ai: { provider: 'imported' }
    });
  };

  const clearAll = () => {
    setMessages([]);
    setContext([]);
    setImportSummary('');
    setAnalysis(fallbackAnalysis);
    setReplyDraft('');
  };

  const openFrameworks = async () => {
    const data = await fetchFrameworks();
    console.log('frameworks', data.frameworks?.length || 0);
  };

  const openSearch = async () => {
    const query = window.prompt('搜索知识库关键词');
    if (!query) return;
    const data = await searchKnowledge(query);
    console.log('search results', data.results?.length || 0);
  };

  return (
    <div className="page-shell">
      <div className="photo-backdrop" aria-hidden="true">
        <Lightfall
          colors={['#EF4444', '#F97316', '#3f53f4']}
          backgroundColor="#120b08"
          speed={0.55}
          streakCount={5}
          streakWidth={0.9}
          streakLength={1.2}
          glow={0.95}
          density={0.72}
          twinkle={0.85}
          zoom={2.6}
          backgroundGlow={0.85}
          opacity={0.62}
          mouseInteraction
          mouseStrength={0.8}
          mouseRadius={0.72}
          mixBlendMode="screen"
        />
      </div>
      <div className="app-frame">
        <section className="main-column">
          <Header
            score={score}
            onClear={clearAll}
            onFrameworks={openFrameworks}
            onSearch={openSearch}
            onApiSettings={() => setApiSettingsOpen(true)}
            onImportChat={() => setWechatImportOpen(true)}
            apiConfig={apiConfig}
          />
          <ChatPanel messages={messages} />
          <Composer onSubmit={handleAnalyze} disabled={loading} />
        </section>
        <AnalysisPanel
          analysis={analysis}
          loading={loading}
          draft={replyDraft}
          onDraftChange={setReplyDraft}
          onSendReply={handleSendReply}
          onUseSuggestion={setReplyDraft}
        />
      </div>
      <ApiSettingsModal
        open={apiSettingsOpen}
        config={apiConfig}
        onClose={() => setApiSettingsOpen(false)}
        onSaved={setApiConfig}
      />
      <WechatImportModal
        open={wechatImportOpen}
        onClose={() => setWechatImportOpen(false)}
        onImport={handleWechatImport}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

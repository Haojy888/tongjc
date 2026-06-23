#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tong Jincheng Chat Bot - Server
Start: python tjc-server.py
Open: http://localhost:8765
"""

import json, re, os, sys, webbrowser
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib import request, error

DEEPSEEK_API_URL = os.environ.get("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "35"))
OPENAI_API_URL = os.environ.get("OPENAI_API_URL", "https://api.openai.com/v1/responses")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")
AI_TIMEOUT = float(os.environ.get("AI_TIMEOUT", os.environ.get("DEEPSEEK_TIMEOUT", "35")))

AI_CONFIG = {
    "active_provider": os.environ.get("AI_PROVIDER", "deepseek").strip().lower() or "deepseek",
    "providers": {
        "deepseek": {
            "label": "DeepSeek",
            "api_key": os.environ.get("DEEPSEEK_API_KEY", "").strip(),
            "model": DEEPSEEK_MODEL,
            "base_url": DEEPSEEK_API_URL,
        },
        "openai": {
            "label": "OpenAI",
            "api_key": os.environ.get("OPENAI_API_KEY", "").strip(),
            "model": OPENAI_MODEL,
            "base_url": OPENAI_API_URL,
        }
    }
}

if AI_CONFIG["active_provider"] not in AI_CONFIG["providers"]:
    AI_CONFIG["active_provider"] = "deepseek"

# Load knowledge base
KB_PATH = Path(__file__).parent / "tjc-knowledge-clean.json"
if KB_PATH.exists():
    with open(KB_PATH, 'r', encoding='utf-8') as f:
        KB = json.load(f)
else:
    KB = {"frameworks":[], "principles":[], "advice_by_scenario":{
        "open":[],"chat":[],"invite":[],"date":[],"escalate":[],"test":[],"longterm":[],"mindset":[],"recover":[]}, "techniques":[]}

def search_knowledge(query, category=None, top_n=10):
    results = []
    for p in KB.get("principles", []):
        score = relevance_score(query, p.get("text", ""))
        if score > 0.3:
            results.append({"type":"principle","text":p["text"],"source":p.get("source",""),"score":score})
    cats = [category] if category else KB.get("advice_by_scenario",{}).keys()
    for cat in cats:
        for a in KB.get("advice_by_scenario",{}).get(cat,[]):
            score = relevance_score(query, a.get("text",""))
            if score > 0.3:
                results.append({"type":"advice","text":a["text"],"source":a.get("source",""),"category":cat,"score":score})
    for fw in KB.get("frameworks",[]):
        for p in fw.get("key_principles",[]):
            score = relevance_score(query, p)
            if score > 0.3:
                results.append({"type":"framework","text":p,"source":fw["name"],"score":score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_n]

def relevance_score(query, text):
    if not query or not text: return 0
    qw = set(query.lower())
    tl = text.lower()
    score = sum(1 for w in qw if w in tl)
    if any(tl.startswith(w) for w in qw): score += 0.5
    return score / max(len(qw), 1)

def compact_list(items, limit=5):
    out = []
    if not isinstance(items, list):
        return out
    for item in items:
        text = str(item).strip()
        if text:
            out.append(text[:180])
        if len(out) >= limit:
            break
    return out

def compact_suggestions(items, limit=3):
    out = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        context_basis = item.get("contextBasis") or item.get("basis") or item.get("context")
        if isinstance(context_basis, str):
            context_basis = [context_basis]
        out.append({
            "tag": str(item.get("tag", "建议")).strip()[:24],
            "intent": str(item.get("intent") or item.get("action") or "").strip()[:20],
            "mode": str(item.get("mode") or item.get("tone") or "").strip()[:16],
            "example": str(item.get("example", "")).strip()[:220],
            "reason": str(item.get("reason", "")).strip()[:260],
            "principle": str(item.get("principle") or item.get("skillPrinciple") or "").strip()[:42],
            "contextBasis": compact_list(context_basis, 3),
            "risk": str(item.get("risk") or item.get("guardrail") or "").strip()[:160],
            "source": str(item.get("source", "童锦程视角")).strip()[:40],
        })
        if len(out) >= limit:
            break
    return [s for s in out if s["example"]]

def compact_context_entries(context, limit=10):
    if not isinstance(context, list):
        return []
    entries = []
    for item in context[-limit:]:
        if not isinstance(item, dict):
            continue
        entry = {}
        if item.get("her"):
            entry["her"] = str(item.get("her", "")).strip()[:280]
        if item.get("my"):
            entry["me"] = str(item.get("my", "")).strip()[:280]
        if item.get("source"):
            entry["source"] = str(item.get("source", "")).strip()[:40]
        if item.get("time"):
            entry["time"] = str(item.get("time", "")).strip()[:40]
        if item.get("analysis") and isinstance(item.get("analysis"), dict):
            entry["previous_signal"] = item["analysis"].get("signal")
            entry["previous_scenario"] = item["analysis"].get("scenario")
            if item["analysis"].get("contextTrend"):
                entry["previous_trend"] = item["analysis"].get("contextTrend")
            if item["analysis"].get("replyIntent"):
                entry["previous_reply_intent"] = item["analysis"].get("replyIntent")
        if entry:
            entry["turn"] = len(entries) + 1
            entries.append(entry)
    return entries

def signal_score(level):
    if level == "strong":
        return 2
    if level == "weak":
        return 0
    return 1

def signal_level_label(level):
    return {"strong": "强", "medium": "中等", "weak": "弱"}.get(level, str(level or "不确定"))

def local_context_insight(msg, context, signal, background):
    entries = compact_context_entries(context, limit=20)
    basis = []
    if background:
        basis.append("已提供手动背景，优先结合背景判断")
    if not entries:
        return {
            "trend": "不确定",
            "summary": "目前缺少前文，只能先按当前消息判断，别把一句话过度解读。",
            "basis": basis or ["没有上一轮聊天记录"]
        }

    last = entries[-1]
    imported_count = sum(1 for entry in entries if entry.get("source") == "wechat-import")
    if imported_count:
        basis.append(f"已纳入微信导入记录 {imported_count} 条")

    previous_signal = last.get("previous_signal") if isinstance(last.get("previous_signal"), dict) else {}
    previous_level = previous_signal.get("level")
    current_level = signal.get("level")

    if not previous_level and imported_count:
        if last.get("her"):
            basis.append("最近一条历史为对方表达")
        if last.get("me"):
            basis.append("最近一条历史为你的回复")
        if last.get("time"):
            basis.append(f"最近历史时间：{last.get('time')}")
        return {
            "trend": "不确定",
            "summary": "已结合导入的微信聊天记录做背景判断，但历史记录缺少逐轮信号评分，先看当前这句是否延续她最近的投入。",
            "basis": basis[:4]
        }

    delta = signal_score(current_level) - signal_score(previous_level)

    if delta > 0:
        trend = "升温"
    elif delta < 0:
        trend = "降温"
    elif current_level == "weak":
        trend = "延续"
    else:
        trend = "延续"

    if previous_level:
        previous_label = str(previous_signal.get("label") or "").strip()
        if not previous_label or previous_label == "?":
            previous_label = signal_level_label(previous_level)
        basis.append(f"上一轮信号：{previous_label}")
    if last.get("my"):
        basis.append("已纳入你上一轮回复后的反馈")
    if last.get("her"):
        basis.append("已对比上一轮她的表达")

    if trend == "升温":
        summary = "当前信号比上一轮更愿意接话，可以自然接住，但别立刻用力过猛。"
    elif trend == "降温":
        summary = "当前信号相对前文变冷，先收住投入，保留体面出口。"
    elif current_level == "weak":
        summary = "低投入状态在延续，回复要短，不要追着解释和加码。"
    else:
        summary = "整体在延续正常聊天，重点是顺着她给出的入口轻轻推进。"

    return {
        "trend": trend,
        "summary": summary,
        "basis": basis[:4] or ["已结合最近对话顺序判断"]
    }

def compact_context_insight(value):
    if not isinstance(value, dict):
        return None
    trend = str(value.get("trend", "不确定")).strip()
    allowed = {"升温", "降温", "延续", "转移", "不确定"}
    if trend not in allowed:
        trend = "不确定"
    basis = compact_list(value.get("basis"), 4)
    summary = str(value.get("summary", "")).strip()
    return {
        "trend": trend,
        "summary": summary[:220],
        "basis": basis
    }

def compact_action_decision(value):
    if not isinstance(value, dict):
        return None
    action = str(value.get("action", "")).strip()
    allowed_actions = {"接住", "收住", "推进", "暂停", "共情", "转移", "观察"}
    if action not in allowed_actions:
        action = "观察"
    confidence = str(value.get("confidence", "中")).strip()
    if confidence not in {"高", "中", "低"}:
        confidence = "中"
    return {
        "action": action,
        "confidence": confidence,
        "headline": str(value.get("headline", "")).strip()[:36],
        "why": str(value.get("why", "")).strip()[:180],
        "nextStep": str(value.get("nextStep", "")).strip()[:120],
        "dont": str(value.get("dont", "")).strip()[:120],
        "mode": str(value.get("mode", "")).strip()[:16],
        "basis": compact_list(value.get("basis"), 3)
    }

def extract_json_object(text):
    text = str(text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise

def current_ai_provider():
    provider = AI_CONFIG.get("active_provider", "deepseek")
    if provider not in AI_CONFIG["providers"]:
        provider = "deepseek"
        AI_CONFIG["active_provider"] = provider
    return provider, AI_CONFIG["providers"][provider]

def public_ai_config():
    provider, active = current_ai_provider()
    providers = {}
    for name, config in AI_CONFIG["providers"].items():
        providers[name] = {
            "label": config.get("label", name),
            "model": config.get("model", ""),
            "baseUrl": config.get("base_url", ""),
            "hasKey": bool(config.get("api_key", "").strip()),
            "active": name == provider
        }
    return {
        "activeProvider": provider,
        "provider": provider,
        "model": active.get("model", ""),
        "baseUrl": active.get("base_url", ""),
        "hasKey": bool(active.get("api_key", "").strip()),
        "providers": providers
    }

def update_ai_config(data):
    if not isinstance(data, dict):
        return public_ai_config()

    provider = str(data.get("provider") or data.get("activeProvider") or AI_CONFIG["active_provider"]).strip().lower()
    if provider not in AI_CONFIG["providers"]:
        provider = "deepseek"
    AI_CONFIG["active_provider"] = provider

    config = AI_CONFIG["providers"][provider]
    model = str(data.get("model", "")).strip()
    base_url = str(data.get("baseUrl") or data.get("base_url") or "").strip()
    api_key = str(data.get("apiKey") or data.get("api_key") or "").strip()

    if model:
        config["model"] = model[:100]
    if base_url:
        config["base_url"] = base_url[:260]
    if api_key:
        config["api_key"] = api_key
    if data.get("clearKey"):
        config["api_key"] = ""

    return public_ai_config()

def merge_ai_analysis(base, ai_data, provider, model):
    if not isinstance(ai_data, dict):
        return base

    merged = dict(base)
    signal = dict(base.get("signal", {}))
    ai_signal = ai_data.get("signal")
    if isinstance(ai_signal, dict):
        level = ai_signal.get("level")
        if level in ("strong", "medium", "weak"):
            signal["level"] = level
            signal["cls"] = "signal-" + level
        label = str(ai_signal.get("label", "")).strip()
        if label:
            signal["label"] = label[:40]
    merged["signal"] = signal

    scenario = str(ai_data.get("scenario", "")).strip()
    if scenario:
        merged["scenario"] = scenario[:20]

    good = compact_list(ai_data.get("goodPoints"), 5)
    if good:
        merged["goodPoints"] = good

    warns = compact_list(ai_data.get("warnPoints"), 5)
    if warns:
        merged["warnPoints"] = warns

    commentary = str(ai_data.get("commentary", "")).strip()
    if commentary:
        merged["commentary"] = commentary[:520]

    suggestions = compact_suggestions(ai_data.get("suggestions"), 3)
    if suggestions:
        merged["suggestions"] = suggestions

    context_insight = compact_context_insight(ai_data.get("contextInsight"))
    if context_insight:
        merged["contextInsight"] = context_insight

    action_decision = compact_action_decision(ai_data.get("actionDecision"))
    if action_decision:
        merged["actionDecision"] = action_decision

    merged["bookKnowledge"] = base.get("bookKnowledge", [])
    merged["ai"] = {"provider": provider, "model": model}
    return merged

def build_ai_prompt(msg, context, background, base):
    kb_hits = []
    for item in base.get("bookKnowledge", [])[:5]:
        kb_hits.append({
            "type": item.get("type", ""),
            "text": str(item.get("text", ""))[:260],
            "source": item.get("source", "")
        })

    return {
        "message_from_her": msg,
        "manual_background": str(background or "").strip()[:1200],
        "recent_context": compact_context_entries(context, limit=30),
        "local_analysis": {
            "signal": base.get("signal"),
            "scenario": base.get("scenario"),
            "goodPoints": base.get("goodPoints", []),
            "warnPoints": base.get("warnPoints", []),
            "suggestions": base.get("suggestions", []),
        },
        "knowledge_hits": kb_hits
    }

def build_system_prompt(provider_label):
    template = """你是“童锦程/景辰视角”的中文聊天分析助手。目标是让分析更聪明、更接地气，而不是油腻套路。
你要严格基于 tong-jincheng-perspective skill 的核心模型：
1. 吸引力原则：吸引 > 讨好，不因为对方冷淡就加倍讨好。
2. 给台阶：回复要给对方体面接话/拒绝/转移的空间。
3. 人性不可考验：不要用冷处理、突袭、阴阳怪气去测试对方。
4. 真诚直接但有边界：不绕、不跪、不施压。
5. 如果不确定她喜欢你，就按不确定处理，别在模糊信号上继续加码。
必须结合 manual_background 和 recent_context 判断，不要只看当前这句。重点看“当前这句相对前文是升温、降温、延续、转移还是不确定”。
如果上下文很少，要明确说依据不足；如果当前消息字面冷但前文热，不能机械判弱；如果当前消息字面热但前文一直冷，也要提醒不要上头。
不要鼓励骚扰、施压、贬低、PUA 或绕过对方拒绝。对低投入信号要劝收住，对高投入信号要给自然推进。
回复建议必须精准贴合 message_from_her、manual_background、recent_context，不要输出“[观察她朋友圈]”这类泛泛模板。每个 example 都必须是可直接发送的中文短句，尽量 8-45 字。
每条 suggestions 必须包含：intent、principle、contextBasis、risk。contextBasis 要引用你依据的具体上下文点，不要编造没有出现过的事实。
必须输出 actionDecision，它是用户第一眼要看的最终行动建议。actionDecision 只允许在这些 action 中选一个：接住、收住、推进、暂停、共情、转移、观察。
只返回 JSON 对象，不要 Markdown，不要解释 JSON 外的文字。
JSON 结构：
{
  "signal": {"level": "strong|medium|weak", "label": "不超过12个中文字"},
  "scenario": "开场|聊天|邀约|升高关系|情绪安抚|测试/边界|长期关系|挽回",
  "contextInsight": {"trend": "升温|降温|延续|转移|不确定", "summary": "结合上下文的判断，80字以内", "basis": ["最多4条依据"]},
  "actionDecision": {
    "action": "接住|收住|推进|暂停|共情|转移|观察",
    "confidence": "高|中|低",
    "headline": "一句话总判断，不超过18字",
    "why": "为什么现在该这么做，必须结合上下文",
    "nextStep": "下一步怎么做",
    "dont": "此刻不要做什么",
    "mode": "稳妥|有趣|推进|降温",
    "basis": ["最多3条具体依据"]
  },
  "goodPoints": ["最多5条，每条不超过45字"],
  "warnPoints": ["最多5条，每条不超过45字"],
  "commentary": "用景辰式口语点评，直接但不低俗，120-220字",
  "suggestions": [
    {
      "tag": "短标签",
      "intent": "接住|收住|转移|推进|共情|给台阶",
      "mode": "稳妥|有趣|推进|降温",
      "example": "可直接发送的中文回复",
      "reason": "为什么这么回，必须结合上下文",
      "principle": "吸引力原则|给台阶|人性不可考验|真诚边界|不确定先别加码",
      "contextBasis": ["最多3条具体依据"],
      "risk": "这句话的风险或使用边界",
      "source": "__PROVIDER_LABEL__ + 童锦程视角"
    }
  ]
}
"""
    return template.replace("__PROVIDER_LABEL__", provider_label)

def extract_response_text(data):
    if isinstance(data, dict):
        if isinstance(data.get("output_text"), str) and data["output_text"].strip():
            return data["output_text"]
        if isinstance(data.get("choices"), list) and data["choices"]:
            message = data["choices"][0].get("message", {})
            if isinstance(message, dict):
                return str(message.get("content", ""))
        chunks = []
        for item in data.get("output", []) or []:
            if not isinstance(item, dict):
                continue
            for content in item.get("content", []) or []:
                if not isinstance(content, dict):
                    continue
                text = content.get("text") or content.get("output_text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)
    return ""

def post_json(url, payload, api_key, timeout):
    req = request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def call_deepseek(config, system_prompt, prompt):
    payload = {
        "model": config.get("model") or DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}
        ],
        "temperature": 0.65,
        "max_tokens": 1200,
        "response_format": {"type": "json_object"}
    }
    return post_json(config.get("base_url") or DEEPSEEK_API_URL, payload, config.get("api_key", ""), AI_TIMEOUT)

def call_openai(config, system_prompt, prompt):
    payload = {
        "model": config.get("model") or OPENAI_MODEL,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt}]
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": json.dumps(prompt, ensure_ascii=False)}]
            }
        ],
        "max_output_tokens": 1400,
        "text": {
            "format": {"type": "json_object"}
        }
    }
    return post_json(config.get("base_url") or OPENAI_API_URL, payload, config.get("api_key", ""), AI_TIMEOUT)

def enhance_with_ai(msg, context, background, base):
    provider, config = current_ai_provider()
    api_key = config.get("api_key", "").strip()
    model = config.get("model", "")
    if not api_key:
        base["ai"] = {"provider": "local", "reason": "missing_api_key", "selectedProvider": provider, "model": model}
        return base

    prompt = build_ai_prompt(msg, context, background, base)
    provider_label = config.get("label", provider)
    system_prompt = build_system_prompt(provider_label)

    try:
        if provider == "openai":
            data = call_openai(config, system_prompt, prompt)
        else:
            data = call_deepseek(config, system_prompt, prompt)
        content = extract_response_text(data)
        ai_data = extract_json_object(content)
        return merge_ai_analysis(base, ai_data, provider, model)
    except Exception as exc:
        reason = type(exc).__name__
        if isinstance(exc, error.HTTPError):
            reason = f"HTTP_{exc.code}"
        base["ai"] = {"provider": "local", "reason": reason, "selectedProvider": provider, "model": model}
        return base

def analyze_message(msg, context=None, background=""):
    msg_clean = msg.strip()
    context = context or []
    msg_len = len(msg_clean)
    short = ["嗯","哦","好","哈哈","呵呵","是的","对","行","ok","嗯嗯","好的","好滴","6","666","hh","hhh","emm","呃"]

    signal = {"level":"medium","label":"中等 - 正常聊天","cls":"signal-medium"}
    if msg_clean.lower() in short:
        signal = {"level":"weak","label":"弱 - 敷衍回复","cls":"signal-weak"}
    elif msg_len < 4:
        signal = {"level":"weak","label":"偏弱","cls":"signal-weak"}
    elif msg_len > 40:
        signal = {"level":"strong","label":"强 - 她投入了","cls":"signal-strong"}
    elif "?" in msg_clean:
        signal = {"level":"strong","label":"强 - 她在提问","cls":"signal-strong"}

    scenario = "聊天"
    if any(kw in msg_clean for kw in ["在吗","你好","认识","加个微信","第一次","刚加","hello","hi"]):
        scenario = "开场"
    elif any(kw in msg_clean for kw in ["见面","出来","有空","周末","一起","约","吃饭","喝杯","看电影","咖啡"]):
        scenario = "邀约"
    elif any(kw in msg_clean for kw in ["牵手","亲","抱","暧昧","喜欢你","想你","梦到","好帅","可爱"]):
        scenario = "升高关系"
    elif any(kw in msg_clean for kw in ["烦","累","不开心","难受","无语","气死","emo","崩溃","好难","麻了"]):
        scenario = "心态建设"

    good = []
    if msg_len > 30: good.append("回复较长，有投入意愿")
    if "?" in msg_clean: good.append("她在提问，想延续对话")
    share_kw = ["今天","刚","我","去了","吃了","看了","觉得","感觉","开心","好好笑"]
    if any(kw in msg_clean for kw in share_kw): good.append("在分享自己的生活——愿意对你敞开")
    meet_kw = ["见面","出来","有空","一起","想你","梦到"]
    if any(kw in msg_clean for kw in meet_kw): good.append("涉及见面/好感话题——高价值信号")

    warns = []
    if msg_clean.lower() in short: warns.append("敷衍式回复，可能礼貌性应付")
    neg_kw = ["烦","累","不开心","难受","无语","气死","崩溃","emo"]
    if any(kw in msg_clean for kw in neg_kw): warns.append("负面情绪——先共情，别讲道理")
    test_kw = ["你以前","你是不是","你觉得她","你前女友","谈过几个","喜欢什么样"]
    if any(kw in msg_clean for kw in test_kw): warns.append("在试探你——别撒谎也别全盘托出")

    book_knowledge = search_knowledge(msg_clean, scenario, top_n=6)
    context_insight = local_context_insight(msg_clean, context, signal, background)
    suggestions = generate_suggestions(msg_clean, signal["level"], scenario, context_insight, context)
    action_decision = local_action_decision(signal, scenario, context_insight, suggestions)

    commentary_parts = []
    if signal["level"] == "weak":
        commentary_parts.append("说实话兄弟们，这信号不太行。记住我那句话：如果你不确定她喜不喜欢你，那她就是不喜欢你。现在别加码，收着点。")
    elif signal["level"] == "strong":
        commentary_parts.append(f"信号不错：{signal['label']}。")
        if good: commentary_parts.append(f"好的方面：{'；'.join(good[:3])}。")
    else:
        commentary_parts.append(f"信号正常：{signal['label']}。")
    if warns: commentary_parts.append(f"注意：{'；'.join(warns)}。")
    commentary_parts.append("沉住气，真诚才是最高级的套路，没毛病吧兄弟们。")

    result = {
        "signal": signal,
        "scenario": scenario,
        "goodPoints": good,
        "warnPoints": warns,
        "suggestions": suggestions,
        "actionDecision": action_decision,
        "commentary": " | ".join(commentary_parts),
        "bookKnowledge": book_knowledge,
        "contextInsight": context_insight
    }
    return enhance_with_ai(msg_clean, context, background, result)

def make_suggestion(tag, intent, example, reason, principle, context_basis, risk, source="童锦程视角"):
    mode_by_intent = {
        "收住": "降温",
        "给台阶": "稳妥",
        "接住": "稳妥",
        "推进": "推进",
        "共情": "稳妥",
        "转移": "有趣"
    }
    return {
        "tag": tag,
        "intent": intent,
        "mode": mode_by_intent.get(intent, "稳妥"),
        "example": example,
        "reason": reason,
        "principle": principle,
        "contextBasis": context_basis,
        "risk": risk,
        "source": source
    }

def local_action_decision(signal, scenario, context_insight, suggestions):
    level = signal.get("level", "medium")
    trend = (context_insight or {}).get("trend", "不确定")
    basis = (context_insight or {}).get("basis") or []
    first = suggestions[0] if suggestions else {}

    action = "接住"
    confidence = "中"
    mode = first.get("mode", "稳妥")
    headline = "接住，但别上头"
    why = "当前还有对话入口，先顺着她的表达接住，不要急着证明自己。"
    next_step = "发一条短句，把话题自然递回去。"
    dont = "不要连发长篇解释，也不要立刻逼她表态。"

    if level == "weak" or trend == "降温":
        action = "收住"
        mode = "降温"
        confidence = "高" if level == "weak" else "中"
        headline = "收住，不要加码"
        why = "当前投入偏低或上下文在降温，继续加码容易变成讨好。"
        next_step = "短回一句，给她空间，看她会不会主动补充。"
        dont = "不要追问她为什么冷，也不要连续解释。"
    elif scenario == "心态建设":
        action = "共情"
        mode = "稳妥"
        headline = "先共情，再判断"
        why = "她在表达情绪时要先接住感受，讲道理会显得不在一边。"
        next_step = "先站队，再轻轻问发生了什么。"
        dont = "不要上来给方案或评价她想太多。"
    elif scenario in ("邀约", "升高关系") and trend in ("升温", "延续"):
        action = "推进"
        mode = "推进"
        confidence = "中" if trend == "延续" else "高"
        headline = "可以轻推一步"
        why = "当前信号允许推进，但要保留台阶，不能把见面或好感说得太重。"
        next_step = "用半开玩笑或顺便的方式推进。"
        dont = "不要把玩笑当确定关系，也不要逼她立刻答应。"
    elif trend == "不确定":
        action = "观察"
        mode = "稳妥"
        confidence = "低"
        headline = "先观察，轻接"
        why = "上下文依据还不够，先按正常聊天处理，不做过度判断。"
        next_step = "回一条轻松短句，看看她是否继续投入。"
        dont = "不要根据一句话直接升高关系。"

    return {
        "action": action,
        "confidence": confidence,
        "headline": headline,
        "why": why,
        "nextStep": next_step,
        "dont": dont,
        "mode": mode,
        "basis": basis[:3]
    }

def generate_suggestions(msg, signal_level, scenario, context_insight=None, context=None):
    context_insight = context_insight or {}
    trend = context_insight.get("trend", "不确定")
    basis = context_insight.get("basis") or ["主要依据当前消息"]
    has_question = "?" in msg or "？" in msg
    is_negative = any(kw in msg for kw in ["烦","累","不开心","难受","无语","气死","emo","崩溃","好难","麻了"])
    suggestions = []
    if signal_level == "weak":
        suggestions.append(make_suggestion(
            "收住投入",
            "收住",
            "行，那你先忙。",
            "她当前投入低，按童锦程逻辑别用更长的话去讨好，短短接住就够。",
            "不确定先别加码",
            basis,
            "如果她后面主动补充，再重新接话；现在不要连发解释。"
        ))
        suggestions.append(make_suggestion(
            "留个台阶",
            "给台阶",
            "没事，等你有空再说。",
            "这句话给她一个体面出口，也保住你的姿态，不把关系逼到尴尬。",
            "给台阶",
            basis,
            "别接着问“你是不是不想聊”，那是在测试人性。"
        ))
        return suggestions
    if scenario == "开场":
        suggestions.append(make_suggestion(
            "轻开场",
            "接住",
            "哈喽，刚看到你这句，感觉还挺自然的。",
            "开场阶段别上来就查户口，先轻轻接住，让对方有继续说的空间。",
            "给台阶",
            basis,
            "不要连续抛问题，容易像面试。"
        ))
        return suggestions
    if scenario == "邀约":
        suggestions.append(make_suggestion(
            "顺势约",
            "推进",
            "可以啊，到时候看你时间，轻松喝一杯就行。",
            "邀约要给台阶，不要把见面说得太重，让她答应和拒绝都体面。",
            "给台阶",
            basis,
            "如果她没有明确兴趣，不要立刻追问具体时间。"
        ))
        suggestions.append(make_suggestion(
            "先模糊",
            "给台阶",
            "那先记着，等你空一点我们再定。",
            "先保留可能性，比立刻敲死时间更自然，也不显得你很急。",
            "人性不可考验",
            basis,
            "不要用“你到底来不来”逼她表态。"
        ))
        return suggestions
    if scenario == "升高关系":
        suggestions.append(make_suggestion(
            "接住不跪",
            "接住",
            "你这么说，我容易当真啊。",
            "她释放好感时要接住，但不能跪下表演深情，保持一点轻松的拉扯。",
            "吸引力原则",
            basis,
            "如果前文一直偏冷，这句要慎用，别把玩笑当确定关系。"
        ))
        suggestions.append(make_suggestion(
            "轻推进",
            "推进",
            "那下次见面你当面再说一遍。",
            "高投入或升温时可以把线上好感转成线下机会，但语气要像玩笑。",
            "真诚边界",
            basis,
            "别在对方没接住时继续升级。"
        ))
        return suggestions
    if scenario == "心态建设" or is_negative:
        suggestions.append(make_suggestion(
            "先站队",
            "共情",
            "听着就烦，先别硬扛，跟我说说怎么回事。",
            "她在表达情绪时先共情，不急着讲道理，这叫接住，不叫讨好。",
            "真诚边界",
            basis,
            "共情后再看她要不要解决方案，不要上来教育她。"
        ))
        suggestions.append(make_suggestion(
            "轻托住",
            "接住",
            "这事换谁都不舒服，你先缓一下。",
            "让她感觉你站在她这边，同时不把情绪无限放大。",
            "给台阶",
            basis,
            "别说“你想太多了”，会直接切断情绪连接。"
        ))
        return suggestions
    if trend == "降温":
        suggestions.append(make_suggestion(
            "降温收口",
            "收住",
            "懂了，那我先不打扰你。",
            "上下文在降温，童锦程视角是先保留体面，不要硬拽对话。",
            "不确定先别加码",
            basis,
            "不要追加第二第三句解释，越解释越像讨好。"
        ))
        return suggestions
    if has_question:
        suggestions.append(make_suggestion(
            "回答后反问",
            "接住",
            "我大概是这么想的。那你呢，你怎么判断？",
            "她在提问就是给入口，先回答再轻轻把话题还给她。",
            "吸引力原则",
            basis,
            "别只顾表现自己，反问要自然，别像审问。"
        ))
        suggestions.append(make_suggestion(
            "真诚短答",
            "接住",
            "说实话，我会更看重舒服和真实。",
            "用真诚表达价值观，不堆人设，也不急着证明自己。",
            "真诚边界",
            basis,
            "别把回答拉成长篇自我介绍。"
        ))
        return suggestions
    # 默认
    suggestions.append(make_suggestion(
        "顺着聊",
        "接住",
        "这个点还挺有意思，你怎么会想到这个？",
        "正常聊天别硬升高，先顺着她给的话题入口走。",
        "给台阶",
        basis,
        "不要突然转邀约，除非前文已经升温。"
    ))
    suggestions.append(make_suggestion(
        "轻展示",
        "接住",
        "我之前也遇到过类似的，确实挺有感触。",
        "轻轻给一点自己的经历，让她知道你有自己的生活，不是围着她转。",
        "吸引力原则",
        basis,
        "别变成炫耀，讲一句就收。"
    ))
    return suggestions


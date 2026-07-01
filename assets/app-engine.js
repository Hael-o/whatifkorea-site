/* ============================================================
   Data-If Korea — 클라이언트 엔진 (server/engine.py·nl2sim.py·main.build_report 포팅)
   정적 호스팅(GitHub Pages)에서 서버 없이 동일 계산.
   서버(FastAPI)가 있으면 프론트가 API를 쓰고, 없으면 이 모듈로 폴백.
   ============================================================ */
(function (global) {
  const AGE_BANDS = ["0-19", "20-34", "35-64", "65+"];
  const YOUTH = "20-34", ELDERLY = "65+";

  function metrics(area) {
    const b = area.bands;
    const total = b["0-19"] + b["20-34"] + b["35-64"] + b["65+"];
    const youth = b[YOUTH], elderly = b[ELDERLY];
    const working = b["20-34"] + b["35-64"];
    const dependent = b["0-19"] + b["65+"];
    const area_km2 = area.area_km2 || 1;
    return {
      total, youth, elderly,
      youthRatio: total ? youth / total : 0,
      agingRatio: total ? elderly / total : 0,
      dependencyRatio: working ? dependent / working : 0,
      density: total / area_km2,
      riskIndex: elderly ? youth / elderly : 0,
    };
  }

  const LIMITATIONS = [
    "일자리·주택가격·교통망·정책 변화 등 외부 변수는 반영되지 않았습니다.",
    "연령대는 4개 구간(0-19/20-34/35-64/65+) 집계 기준입니다.",
    "지방소멸 위험은 청년/고령 비 기반 단순 지표이며 공식 소멸지수와 다릅니다.",
    "이동은 선택 연령대 내에서만 이뤄지며 출생·사망·자연증감은 제외됩니다.",
  ];

  function applyOp(areas, op) {
    const age = AGE_BANDS.includes(op.ageGroup) ? op.ageGroup : YOUTH;
    const pct = (code, p) => Math.round(areas[code].bands[age] * p / 100);
    if (op.type === "move_population") {
      const fr = op.fromAreaCode, to = op.toAreaCode;
      let val = op.unit === "percent" ? pct(fr, op.value) : Math.round(op.value);
      val = Math.max(0, Math.min(val, areas[fr].bands[age]));
      areas[fr].bands[age] -= val; areas[to].bands[age] += val;
    } else if (op.type === "increase_population") {
      const c = op.targetAreaCode;
      const val = op.unit === "percent" ? pct(c, op.value) : Math.round(op.value);
      areas[c].bands[age] += val;
    } else if (op.type === "decrease_population") {
      const c = op.targetAreaCode;
      let val = op.unit === "percent" ? pct(c, op.value) : Math.round(op.value);
      val = Math.min(val, areas[c].bands[age]);
      areas[c].bands[age] -= val;
    }
  }

  function confidence(opCount) {
    let score = 100 - (100 - 85) * 0.5 - opCount * 8;
    const grade = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
    const reason = {
      high: "최신 집계 데이터·단순 계산·직접 관련 변수만 사용",
      medium: "기준 데이터는 최신이나 일자리·주택 등 외부 변수는 미반영",
      low: "가정이 많거나 결측이 커서 해석에 주의가 필요",
    }[grade];
    return { grade, score: Math.round(score), reason };
  }

  function run(base, ops) {
    const areas0 = base.areas;
    const before = {}, work = {};
    for (const c in areas0) {
      before[c] = metrics(areas0[c]);
      work[c] = { bands: Object.assign({}, areas0[c].bands), area_km2: areas0[c].area_km2 };
    }
    ops.forEach(op => applyOp(work, op));
    const after = {}, delta = {};
    for (const c in areas0) {
      after[c] = metrics(work[c]);
      delta[c] = {}; for (const k in before[c]) delta[c][k] = after[c][k] - before[c][k];
    }
    const ranked = Object.keys(areas0).sort((a, b) => Math.abs(delta[b].total) - Math.abs(delta[a].total));
    const top = [];
    for (const c of ranked) {
      if (delta[c].total === 0 && delta[c].youth === 0) continue;
      top.push({
        code: c, name: areas0[c].name, deltaTotal: delta[c].total, deltaYouth: delta[c].youth,
        deltaYouthRatio: Math.round(delta[c].youthRatio * 100 * 100) / 100,
        deltaAgingRatio: Math.round(delta[c].agingRatio * 100 * 100) / 100,
      });
      if (top.length >= 10) break;
    }
    const areasOut = {};
    for (const c in areas0) areasOut[c] = { name: areas0[c].name, before: before[c], after: after[c], delta: delta[c] };
    return {
      baseYear: base.baseYear, basePeriod: base.basePeriod, source: base.source,
      areas: areasOut, topImpactedAreas: top, confidence: confidence(ops.length),
      limitations: LIMITATIONS,
    };
  }

  /* ---- NL2Sim (시도 전용 규칙 파서) ---- */
  const ALIASES = {
    "11": ["서울특별시", "서울시", "서울"], "21": ["부산광역시", "부산시", "부산"],
    "22": ["대구광역시", "대구시", "대구"], "23": ["인천광역시", "인천시", "인천"],
    "24": ["광주광역시", "광주시", "광주"], "25": ["대전광역시", "대전시", "대전"],
    "26": ["울산광역시", "울산시", "울산"], "29": ["세종특별자치시", "세종시", "세종"],
    "31": ["경기도", "경기"], "32": ["강원특별자치도", "강원도", "강원"],
    "33": ["충청북도", "충북"], "34": ["충청남도", "충남"], "35": ["전라북도", "전북"],
    "36": ["전라남도", "전남"], "37": ["경상북도", "경북"], "38": ["경상남도", "경남"],
    "39": ["제주특별자치도", "제주도", "제주"],
  };
  const ALIAS_ORDER = [];
  for (const c in ALIASES) for (const a of ALIASES[c]) ALIAS_ORDER.push([a, c]);
  ALIAS_ORDER.sort((x, y) => y[0].length - x[0].length);
  const UNSUPPORTED = [
    [/집값|부동산|주택가격|아파트\s*값/, "부동산 가격 예측"],
    [/선거|득표|투표\s*결과/, "선거 결과 예측"],
    [/매출|주가|환율|코스피/, "기업 매출·금융 예측"],
    [/날씨|기온|강수/, "기상 예측"],
  ];
  function ageOf(t) {
    if (/청년|2030|20\s*[~\-]\s*34|20\s*대|30\s*대/.test(t)) return "20-34";
    if (/고령|노인|어르신|65\s*세|65\s*이상/.test(t)) return "65+";
    if (/유소년|어린이|아동|0\s*[~\-]\s*19|미성년/.test(t)) return "0-19";
    if (/중장년|3564|35\s*[~\-]\s*64|중년/.test(t)) return "35-64";
    return null;
  }
  function valueOf(t) {
    let m = t.match(/(\d+(?:\.\d+)?)\s*%/); if (m) return [parseFloat(m[1]), "percent"];
    m = t.match(/(\d[\d,]*)\s*만\s*명?/); if (m) return [Math.round(parseFloat(m[1].replace(/,/g, "")) * 10000), "people"];
    m = t.match(/(\d[\d,]*)\s*천\s*명?/); if (m) return [Math.round(parseFloat(m[1].replace(/,/g, "")) * 1000), "people"];
    m = t.match(/(\d[\d,]{2,})\s*명?/); if (m) return [parseInt(m[1].replace(/,/g, ""), 10), "people"];
    return [null, null];
  }
  function regionsOf(t) {
    const hits = [], used = new Array(t.length).fill(false);
    for (const [alias, code] of ALIAS_ORDER) {
      let start = 0;
      while (true) {
        const i = t.indexOf(alias, start); if (i < 0) break;
        let free = true; for (let j = i; j < i + alias.length; j++) if (used[j]) { free = false; break; }
        if (free) { for (let j = i; j < i + alias.length; j++) used[j] = true; hits.push([i, code, alias]); }
        start = i + alias.length;
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    const seen = new Set(), out = [];
    for (const h of hits) { if (seen.has(h[1])) continue; seen.add(h[1]); out.push(h); }
    return out;
  }
  function parse(text) {
    const t = (text || "").trim();
    const base = { isSupported: true, topic: "population_migration", baseYear: 2024, operations: [],
      needClarification: false, clarificationQuestion: null, unsupportedReason: null, echo: t };
    for (const [re, label] of UNSUPPORTED) if (re.test(t)) {
      base.isSupported = false; base.topic = null;
      base.unsupportedReason = `현재 MVP에서는 ${label}을(를) 지원하지 않습니다. 인구 이동·증감, 청년 비율·고령화율·부양비 변화만 지원합니다.`;
      return base;
    }
    const age = ageOf(t) || "20-34";
    const [val, unit] = valueOf(t);
    const regs = regionsOf(t);
    const mv = /이동|옮겨|이주|전입|분산|빠져|유출|유입/.test(t);
    const inc = /증가|늘어|늘면|유입|추가|더\s*생기|순유입/.test(t);
    const dec = /감소|줄어|줄면|이탈|빠져나|유출|순유출/.test(t);
    if (val == null) { base.needClarification = true; base.clarificationQuestion = "변화 규모를 알려주세요. 예: '5만 명' 또는 '10%'."; return base; }
    if (mv && regs.length >= 2) base.operations = [{ type: "move_population", fromAreaCode: regs[0][1], toAreaCode: regs[1][1], ageGroup: age, value: val, unit }];
    else if (mv && regs.length === 1) { base.needClarification = true; base.clarificationQuestion = `'${regs[0][2]}'에서 어느 지역으로 이동하나요? 도착 지역을 알려주세요.`; }
    else if (inc && regs.length >= 1) base.operations = [{ type: "increase_population", targetAreaCode: regs[0][1], ageGroup: age, value: val, unit }];
    else if (dec && regs.length >= 1) base.operations = [{ type: "decrease_population", targetAreaCode: regs[0][1], ageGroup: age, value: val, unit }];
    else if (regs.length >= 2) base.operations = [{ type: "move_population", fromAreaCode: regs[0][1], toAreaCode: regs[1][1], ageGroup: age, value: val, unit }];
    else { base.needClarification = true; base.clarificationQuestion = "어느 지역인가요? 시도 이름(예: 서울, 세종)을 포함해 주세요."; }
    return base;
  }

  /* ---- report (main.build_report 포팅) ---- */
  const fmt = n => Math.round(n).toLocaleString("en-US");
  function buildReport(result, ops, tone) {
    const top = result.topImpactedAreas, A = result.areas;
    const parts = ops.map(op => {
      const age = op.ageGroup || "20-34", vs = op.unit === "percent" ? op.value + "%" : fmt(op.value) + "명";
      if (op.type === "move_population") return `${A[op.fromAreaCode].name}→${A[op.toAreaCode].name} ${age} 인구 ${vs} 이동`;
      if (op.type === "increase_population") return `${A[op.targetAreaCode].name} ${age} 인구 ${vs} 증가`;
      return `${A[op.targetAreaCode].name} ${age} 인구 ${vs} 감소`;
    });
    const summary = parts.length ? parts.join(" · ") : "변화 없음";
    const ins = top.slice(0, 3).map(a => `${a.name}: 총인구 ${fmt(Math.abs(a.deltaTotal))}명 ${a.deltaTotal >= 0 ? "증가" : "감소"}, 청년비율 ${a.deltaYouthRatio >= 0 ? "+" : ""}${a.deltaYouthRatio.toFixed(2)}%p, 고령화율 ${a.deltaAgingRatio >= 0 ? "+" : ""}${a.deltaAgingRatio.toFixed(2)}%p`);
    const toneNote = { general: "일반 설명형", article: "기사 초안형", policy: "정책 브리프형", exec: "경영진 요약형" }[tone] || "일반 설명형";
    const blocks = [
      { type: "summary", title: "시나리오 요약", text: `[${toneNote}] 기준 ${result.basePeriod || result.baseYear} 데이터에서 ${summary}을(를) 가정해 계산했습니다.`,
        linkedAreaCodes: ops.map(o => o.fromAreaCode || o.targetAreaCode).filter(Boolean) },
      { type: "insight", title: "핵심 변화", text: ins.length ? ins.join(" / ") : "유의미한 변화가 없습니다.", linkedAreaCodes: top.slice(0, 3).map(a => a.code) },
    ];
    if (top.length) { const b = top[0]; blocks.push({ type: "insight", title: "가장 큰 영향 지역", text: `${b.name}의 변화가 가장 큽니다 (총인구 ${b.deltaTotal >= 0 ? "+" : ""}${fmt(b.deltaTotal)}명, 청년비율 ${b.deltaYouthRatio >= 0 ? "+" : ""}${b.deltaYouthRatio.toFixed(2)}%p).`, linkedAreaCodes: [b.code] }); }
    blocks.push({ type: "warning", title: "결과의 한계", text: result.limitations.join(" "), linkedAreaCodes: [] });
    blocks.push({ type: "evidence", title: "데이터 출처", text: result.source + " · 경계: southkorea-maps(통계청 2018) · 가정 기반 단순 시뮬레이션이며 실제 결과를 보장하지 않습니다.", linkedAreaCodes: [] });
    return { tone: toneNote, summary, blocks, confidence: result.confidence };
  }

  global.DataIfEngine = { metrics, run, parse, buildReport };
})(window);

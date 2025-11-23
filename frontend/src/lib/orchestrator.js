import { callLLM } from './llm';
import { aiSearch } from './baidu';

/**
 * Main Orchestrator for the analysis flow
 */
export async function* runAnalysisFlow(query, { baiduKey, volcKey, baiduModel = 'deepseek-r1', topK = 10, sites = null } = {}) {
  yield { type: 'planning', plan: { timelimit: 'm', use_rss: false }, version: '0.3.2-frontend-ai' };

  // 1) 统一检索（百度AI）
  yield { type: 'search', mode: 'ai', batch_count: 0, ai_topk: topK, ai_sites_pick: Array.isArray(sites) ? sites : [] };
  let ai1;
  try {
    ai1 = await aiSearch(query, { apiKey: baiduKey, model: baiduModel, topK, sites });
  } catch (e) {
    yield { type: 'error', message: 'Baidu AI Search failed: ' + (e?.message || e) };
    return;
  }
  const batch1 = Array.isArray(ai1.items) ? ai1.items : [];
  yield { type: 'search', mode: 'ai', batch_count: batch1.length, ai_topk: topK, ai_sites_pick: Array.isArray(sites) ? sites : [] };

  // 2) 质量判定（豆包）
  let gate1 = { ready: false, confidence: 50, reasons: [], refine_keywords: [], recheck_query: '' };
  try {
    const materialsText = batch1.slice(0, 10).map((it, idx) => `[${idx + 1}] 【${it.source || '来源'}】${it.title}\n    摘要：${(it.body || '').slice(0, 200)}`).join('\n');
    const userPrompt = `你现在的身份是【高级舆情分析总监】。评估以下材料是否足以撰写高质量《舆情分析报告》。\n\n用户指令：${query}\n\n当前材料：\n${materialsText}\n\n请只输出JSON：{ "ready": true/false, "confidence": 0-100, "reason": "...", "next_step_suggestion": { "need_search": true/false, "search_query": "..." } }`;
    const resp = await callLLM(volcKey, [
      { role: 'system', content: '你是一个严谨的情报分析总监。只输出JSON。' },
      { role: 'user', content: userPrompt }
    ]);
    const clean = String(resp || '').replace('```json', '').replace('```', '').trim();
    const data = JSON.parse(clean);
    gate1 = {
      ready: !!data.ready,
      confidence: parseInt(data.confidence || 50, 10),
      reasons: [data.reason || '未说明理由'],
      refine_keywords: (data.next_step_suggestion?.search_query || '').split(' ').filter(Boolean).slice(0, 3),
      recheck_query: data.next_step_suggestion?.search_query || ''
    };
  } catch (e) {
    // 若豆包不可用，保守继续走重检
  }
  yield { type: 'doubao_gate', ready: gate1.ready, confidence: gate1.confidence, reasons: gate1.reasons, refine_keywords: gate1.refine_keywords, recheck_query: gate1.recheck_query };

  if (gate1.ready) {
    // 3) 详细报告（豆包）
    const report = await generateReport(volcKey, query, ai1.summary || '', batch1);
    yield { type: 'final', summary: ai1.summary || '', detailed_report: report, items: batch1 };
    return;
  }

  // 4) 二次检索（根据建议）
  const reQ = gate1.recheck_query?.trim() || [query, ...(gate1.refine_keywords || [])].join(' ').trim();
  yield { type: 'search', mode: 'ai_recheck', batch_count: 0, ai_topk: topK, ai_sites_pick: Array.isArray(sites) ? sites : [], recheck_query: reQ };
  let ai2;
  try {
    ai2 = await aiSearch(reQ || query, { apiKey: baiduKey, model: baiduModel, topK, sites });
  } catch (e) {
    yield { type: 'error', message: 'Baidu AI recheck failed: ' + (e?.message || e) };
    return;
  }
  const batch2 = Array.isArray(ai2.items) ? ai2.items : [];
  yield { type: 'search', mode: 'ai_recheck', batch_count: batch2.length, ai_topk: topK, ai_sites_pick: Array.isArray(sites) ? sites : [], recheck_query: reQ };

  // 5) 再次质量判定
  let gate2 = { ready: false, confidence: 50, reasons: [], refine_keywords: [], recheck_query: '' };
  try {
    const materialsText2 = batch2.slice(0, 10).map((it, idx) => `[${idx + 1}] 【${it.source || '来源'}】${it.title}\n    摘要：${(it.body || '').slice(0, 200)}`).join('\n');
    const userPrompt2 = `你现在的身份是【高级舆情分析总监】。评估以下材料是否足以撰写高质量《舆情分析报告》。\n\n用户指令：${reQ || query}\n\n当前材料：\n${materialsText2}\n\n请只输出JSON：{ "ready": true/false, "confidence": 0-100, "reason": "..." }`;
    const resp2 = await callLLM(volcKey, [
      { role: 'system', content: '你是一个严谨的情报分析总监。只输出JSON。' },
      { role: 'user', content: userPrompt2 }
    ]);
    const clean2 = String(resp2 || '').replace('```json', '').replace('```', '').trim();
    const data2 = JSON.parse(clean2);
    gate2 = {
      ready: !!data2.ready,
      confidence: parseInt(data2.confidence || 50, 10),
      reasons: [data2.reason || '未说明理由'],
      refine_keywords: [],
      recheck_query: ''
    };
  } catch (e) {
    // 若豆包不可用，继续强制生成报告
  }
  yield { type: 'doubao_gate', ready: gate2.ready, confidence: gate2.confidence, reasons: gate2.reasons };

  // 6) 输出报告（若ready或强制）
  const itemsAll = batch2.length ? batch2 : batch1;
  const brief = ai2?.summary || ai1?.summary || '';
  const report2 = await generateReport(volcKey, reQ || query, brief, itemsAll);
  yield { type: 'final', summary: brief, detailed_report: report2, items: itemsAll };
}

async function generateReport(volcKey, query, briefSummary, items) {
  // 详细报告生成（豆包），参考后端结构化提示
  const materialsText = items.slice(0, 15).map((it, idx) => (
    `[${idx + 1}] 标题：${it.title}\n来源：${it.source || ''}\n链接：${it.href || ''}\n内容：${(it.body || '').slice(0, 500)}`
  )).join('\n\n');

  const prompt = `你是专业的舆情分析报告撰写专家。请基于以下材料，撰写一份详细的舆情分析报告。\n\n用户问题：${query}\n\n统一检索简要摘要（仅供参考）：\n${briefSummary || '（无）'}\n\n材料（共${items.length}条）：\n${materialsText}\n\n请按以下结构输出Markdown格式的详细报告：\n# 一、事件概览\n# 二、关键事实与时间线\n# 三、涉及主体\n# 四、官方与权威来源\n# 五、公众舆情与传播\n# 六、风险与影响分析\n# 七、结论与建议\n\n不要在报告中输出参考资料章节；引用来源不需要在报告内列出。`;

  try {
    const out = await callLLM(volcKey, [
      { role: 'system', content: '你是专业的舆情分析报告撰写专家。' },
      { role: 'user', content: prompt }
    ]);
    return String(out || '').trim();
  } catch (e) {
    return `# 舆情分析报告：${query}\n\n## 事件概览\n${briefSummary || '暂无摘要'}\n`;
  }
}

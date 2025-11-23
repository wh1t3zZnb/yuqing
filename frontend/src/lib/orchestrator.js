import { callLLM } from './llm';
import { aiSearch } from './baidu';

export async function* runAnalysisFlow(query, { apiUrl, model = 'doubao-seed-1-6-251015', service = 'volc', baiduModel = 'ERNIE-4.0-mini' } = {}) {
  yield { type: 'planning', plan: { timelimit: 'm', use_rss: true }, version: '0.6.0-workers' };

  yield { type: 'baidu_search_start' };
  let items = [];
  let brief = '';
  try {
    const { items: found, summary } = await aiSearch(query, { apiUrl, model: baiduModel, topK: 10, modelCandidates: [baiduModel, 'ERNIE-3.5', 'ERNIE-Speed-128k'] });
    items = Array.isArray(found) ? found : [];
    brief = String(summary || '').trim();
    yield { type: 'baidu_search_ok', items: items.length };
  } catch (e) {
    items = [];
    brief = '';
    yield { type: 'baidu_search_failed', message: e.message || 'Baidu AI 搜索失败' };
  }

  yield { type: 'filter', accepted_this_round: items.length };
  yield { type: 'fetch', success: items.length, fail: 0 };

  let report = '';
  try {
    const refsText = items.map((it, i) => `${i + 1}. ${it.title || it.href} ${it.href || ''}`).join('\n');
    const messages = [
      { role: 'system', content: '你是专业的舆情分析报告撰写专家。' },
      { role: 'user', content: `请按Markdown结构撰写《舆情分析报告》，主题：${query}。以下是参考材料链接（可用于提取要点与论证）：\n${refsText || '（未使用百度材料，本报告为直出）'}` }
    ];
    report = await callLLM(apiUrl, messages, model, service);
  } catch (e) {
    report = '';
    yield { type: 'error', message: e.message || 'LLM 生成报告失败' };
  }

  yield { type: 'final', summary: brief, detailed_report: report, items };
}

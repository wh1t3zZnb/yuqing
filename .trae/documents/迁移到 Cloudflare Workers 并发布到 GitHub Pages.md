## 我对项目的理解
- 前端为 React + Vite，入口在 `frontend/index.html`，主文件 `frontend/src/main.jsx`，核心页面 `frontend/src/App.jsx`。
- 现有两类 API：
  - 百度 AI 搜索，封装在 `frontend/src/lib/baidu.js`，通过本地开发代理 `'/api/baidu'` 请求 `qianfan.baidubce.com`。
  - 豆包（火山引擎），封装在 `frontend/src/lib/llm.js`，通过本地开发代理 `'/api/volc'` 请求 `volces.com`。
- 设置面板在 `frontend/src/App.jsx:161-185`，要求用户填两个 Key，并在 `localStorage` 保存（`doubao_apikey`、`baidu_apikey`）。
- 编排逻辑在 `frontend/src/lib/orchestrator.js`：先百度检索，再用豆包做质量判定与生成报告。

## 变更目标
- 删除页面上的“豆包/百度两个 API Key”的设置与相关校验。
- 改为只调用 Cloudflare Workers 暴露的 `POST /api/chat`，由 Worker 持有上游服务密钥（不在浏览器保存任何密钥）。
- 项目打包为静态网页，发布到 GitHub Pages，可 HTTPS 访问。

## 前端改造方案
- 移除 Key 输入：删除 `frontend/src/App.jsx` 中的两个密码框与 `localStorage` 读写（`161-185`、`22-28`）。
- 新增“接口地址”设置：在页面保留一个输入框存储 `apiUrl`（如 `https://<worker>.<account>.workers.dev/api/chat`），使用 `localStorage('api_url')`。
- 替换 LLM 调用：把 `frontend/src/lib/llm.js` 改为调用 Worker，而不是 `'/api/volc'`。
  - 现状：`frontend/src/lib/llm.js:7-11` 使用 `apiKey` 与 `'/api/volc'`。
  - 变更：改函数签名为 `callLLM(apiUrl, messages, model)`，请求：
```js
export async function callLLM(apiUrl, messages, model = 'qwen-plus') {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.3, stream: false, enable_thinking: false })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
```
- 简化编排：将 `frontend/src/lib/orchestrator.js` 从“百度检索→豆包判定→再检索→豆包报告”改成“直接用 LLM 生成摘要与报告”。示例：
```js
export async function* runAnalysisFlow(query, { apiUrl, model = 'qwen-plus' } = {}) {
  yield { type: 'planning', plan: { timelimit: 'm', use_rss: false }, version: '0.4.0-workers' };
  const brief = await callLLM(apiUrl, [
    { role: 'system', content: '只输出简要摘要。' },
    { role: 'user', content: `请给主题【${query}】写一段100字内的摘要。` }
  ], model);
  const report = await callLLM(apiUrl, [
    { role: 'system', content: '你是专业的舆情分析报告撰写专家。' },
    { role: 'user', content: `请按Markdown结构撰写《舆情分析报告》，主题：${query}` }
  ], model);
  yield { type: 'final', summary: brief, detailed_report: report, items: [] };
}
```
- UI 调整：
  - `frontend/src/App.jsx` 中的校验 `start()` 去掉 Key 校验（`47-50`），改为校验 `apiUrl` 是否填写。
  - 日志与导出 Markdown 不变；代表材料 `items` 暂为空（无检索）。
- 删除开发代理：去掉 `frontend/vite.config.js:8-21` 的 `server.proxy` 配置，并为 GitHub Pages 设置 `base`：
```js
export default defineConfig({ plugins: [react()], base: '/<你的仓库名>/' })
```

## Workers 配置（按照 `WORKERS_PROXY_GUIDE.md`）
- 在 Cloudflare 创建 Worker（模板选“HTTP Handler”），脚本为：
```js
export default { async fetch(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = 'https://<your-user>.github.io';
  const setCORS = (h) => { h.set('Access-Control-Allow-Origin', origin === allowOrigin ? allowOrigin : 'null'); h.set('Vary','Origin'); h.set('Access-Control-Allow-Methods','POST,OPTIONS'); h.set('Access-Control-Allow-Headers','Content-Type'); };
  if (request.method === 'OPTIONS') { const h = new Headers(); setCORS(h); return new Response('', { status: 200, headers: h }); }
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    let payload = {}; try { payload = await request.json(); } catch {}
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}` }, body: JSON.stringify(payload)
    });
    const text = await resp.text(); const h = new Headers({ 'Content-Type': 'application/json' }); setCORS(h);
    return new Response(text, { status: resp.status, headers: h });
  }
  return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
} }
```
- 变量与部署：在 Worker 的“设置 → Variables”添加 Secret：`DASHSCOPE_API_KEY`（你的上游密钥），部署后得到 `https://<worker>.<account>.workers.dev/api/chat`。
- 注意：把 `allowOrigin` 改成你 GitHub Pages 的域名（如 `https://<your-user>.github.io` 或 `https://<your-user>.github.io/<repo>`）。

## 前端请求格式（你网页改成这样）
```js
const apiUrl = localStorage.getItem('api_url') || 'https://<worker>.<account>.workers.dev/api/chat';
const messages = [{ role: 'user', content: '你好' }];
const res = await fetch(apiUrl, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  body: JSON.stringify({ model: 'qwen-plus', messages, temperature: 0.3, stream: false, enable_thinking: false })
});
const data = await res.json();
```

## GitHub Pages 发布
- 把代码推到 GitHub 仓库（公开或私有 + Pages）。
- 在 `vite.config.js` 设置 `base: '/<仓库名>/'`，执行打包：`npm i && npm run build`，产物在 `frontend/dist`。
- 开通 Pages：
  - 方式A：把 `frontend/dist` 推到 `gh-pages` 分支，Pages 指定 `gh-pages`（根目录）。
  - 方式B：用 GitHub Actions 自动部署，触发 `on: push` 到 `main` 后构建并发布 `dist`。
- 线上地址形如：`https://<your-user>.github.io/<仓库名>/`。

## 验证与排查
- 在浏览器调试台确认 `location.origin` 与 Worker 的 `allowOrigin` 一致，否则 CORS 报错。
- 前端只用标准头：`Content-Type: application/json`，不要自定义 Authorization（密钥只在 Worker）。
- 预检 200 但正式请求 CORS：检查 `allowOrigin` 与 Pages 域名；确认不是用 `http://` 访问。
- 404：确认请求的是 `POST /api/chat`，不是根路径。

## 我将进行的代码修改（获批后执行）
- `frontend/src/App.jsx`：删除两个 Key 输入与校验；新增 `apiUrl` 输入；校验 `apiUrl`。
- `frontend/src/lib/llm.js`：改为调用 Worker；去掉 `Authorization` 与 `'/api/volc'`。
- `frontend/src/lib/orchestrator.js`：移除对 `aiSearch` 的依赖，改为直接生成摘要与报告。
- `frontend/src/lib/baidu.js`：不再使用（后续可删除或保留为注释文档）。
- `frontend/vite.config.js`：删除 `server.proxy`；增加 `base` 适配 Pages。

如果你确认这个方案，我就开始按以上文件逐一改动并提供开发日志与验证步骤。
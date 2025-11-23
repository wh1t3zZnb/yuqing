# Cloudflare Workers + GitHub Pages 接口代理复用指南

## 目标
- 把网页部署在 GitHub Pages（HTTPS）。
- 把接口请求交给 Cloudflare Workers（稳定 HTTPS，密钥保管在后台）。
- 浏览器不再报“混合内容 / CORS / 临时隧道 511/503”。
- 密钥不进浏览器代码，不需要你自己的服务器公网地址。

## 你需要准备
- 一个 Cloudflare 账号（免费）。
- 第三方服务的密钥（例如 DashScope 的 `DASHSCOPE_API_KEY`）。
- 你的网页域名（Origin），如 `https://wh1t3zznb.github.io`。

## 快速流程（4 步）
- 在 Cloudflare 创建 Worker（模板选“HTTP Handler”）。
- 粘贴本指南提供的 Worker 脚本，设置 `allowOrigin` 为你的网页域名。
- 在 Worker “设置 → 变量（Variables）”添加 Secret（名称与脚本一致），部署。
- 在网页里把接口地址改为 `https://<worker名>.<账号>.workers.dev/api/chat`。

## Worker 脚本
- 作用：接受网页的 `POST /api/chat`，用你的密钥调用上游 API（如 DashScope），把结果返回给网页。
- 把 `allowOrigin` 改成你的实际网页域名（用浏览器控制台 `location.origin` 查看）。

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = 'https://wh1t3zznb.github.io';

    const setCORS = (headers) => {
      headers.set('Access-Control-Allow-Origin', origin === allowOrigin ? allowOrigin : 'null');
      headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    };

    if (request.method === 'OPTIONS') {
      const h = new Headers(); setCORS(h);
      return new Response('', { status: 200, headers: h });
    }

    if (request.method === 'POST' && url.pathname === '/api/chat') {
      let payload = {}; try { payload = await request.json(); } catch {}

      const upstreamBody = JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        temperature: payload.temperature ?? 0.3,
        stream: payload.stream ?? false,
        enable_thinking: payload.enable_thinking ?? false,
        ...payload.extra
      });

      const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`
        },
        body: upstreamBody
      });

      const text = await resp.text();
      const h = new Headers({ 'Content-Type': 'application/json' }); setCORS(h);
      return new Response(text, { status: resp.status, headers: h });
    }

    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

## 设置密钥并部署
- 在 Worker 页面右上角或概览页进入“设置”。
- 打开“变量（Variables）”。
- 添加 Secret：
  - 名称：`DASHSCOPE_API_KEY`
  - 值：你的 DashScope 密钥
- 返回编辑器点击“部署”，复制生成的地址：
  - `https://<worker名>.<账号>.workers.dev/api/chat`

## 在网页里接入
- 打开你网页的“连接设置”（右上角齿轮），把接口地址改为上面的 Worker 链接，保存。
- 当前项目的关键位置：
  - 默认接口地址：`/root/llmAPI/1.html:110`
  - 发送逻辑（`fetch`）：`/root/llmAPI/1.html:153-177`
  - 设置弹窗与持久化：`/root/llmAPI/1.html:193-228`
  - 齿轮入口：`/root/llmAPI/1.html:315-320`

## 前端请求示例（通用）
```js
const apiUrl = 'https://<worker名>.<账号>.workers.dev/api/chat';

async function callChat(messages) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      service: 'dashscope',
      model: 'qwen3-32b-ft-202511230210-0153',
      messages,
      temperature: 0.3,
      stream: false,
      enable_thinking: false
    })
  });
  return await res.json();
}
```

## 常见问题与排查
- 预检 200，正式请求 CORS 错误
  - 保证前端只用标准头：`Content-Type: application/json`。
  - Worker 的 `allowOrigin` 要与网页域名一致（例如 `https://wh1t3zznb.github.io`）。
- 404 not_found
  - 访问的是根路径 `/`；改为 `POST /api/chat`。
- 401/403（未授权）
  - Secret 名称必须与脚本一致（示例使用 `DASHSCOPE_API_KEY`）。
  - 值是否正确，部署后是否生效。
- Mixed Content（混合内容）
  - 网页必须访问 HTTPS（Workers 链接为 HTTPS）。
- 5xx/超时
  - 多为上游服务响应问题；稍后重试或减少并发。

## 复用清单（每个项目都照这个做）
- 网页部署到 GitHub Pages（或任何 HTTPS 静态站）。
- 创建 Worker，粘贴脚本，`allowOrigin=你的网页域名`。
- 添加 Secret，部署，得到 `workers.dev` 链接。
- 前端把接口地址改为该链接，发送标准 JSON 请求。
- 测试一条消息；如报错，按“常见问题与排查”处理。

## 安全与维护建议
- 密钥只放 Workers Secret，不放浏览器或仓库。
- 定期轮换密钥；变更后重新部署 Worker。
- 如需更强控制与日志，可后续改为你自己的域名与反向代理，但复用流程不变（网页→代理→上游）。
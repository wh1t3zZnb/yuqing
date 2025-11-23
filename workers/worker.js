export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const allowOrigin = 'https://wh1t3zznb.github.io'
    const setCORS = (h) => {
      h.set('Access-Control-Allow-Origin', origin === allowOrigin ? allowOrigin : 'null')
      h.set('Vary', 'Origin')
      h.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
      h.set('Access-Control-Allow-Headers', 'Content-Type, Accept')
    }
    if (request.method === 'OPTIONS') {
      const h = new Headers(); setCORS(h)
      return new Response('', { status: 200, headers: h })
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      let payload = {}; try { payload = await request.json() } catch {}
      const apiKey = env.VOLC_API_KEY
      if (!apiKey) {
        const h = new Headers({ 'Content-Type': 'application/json' }); setCORS(h)
        return new Response(JSON.stringify({ error: 'missing_api_key' }), { status: 401, headers: h })
      }
      let resp
      if (payload.service === 'baidu') {
        const bkey = env.BAIDU_API_KEY
        if (!bkey) {
          const h = new Headers({ 'Content-Type': 'application/json' }); setCORS(h)
          return new Response(JSON.stringify({ error: 'missing_baidu_api_key' }), { status: 401, headers: h })
        }
        resp = await fetch('https://qianfan.baidubce.com/v2/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${bkey}`
          },
          body: JSON.stringify(payload)
        })
        if (resp.status === 401) {
          resp = await fetch('https://qianfan.baidubce.com/v2/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer+ ${bkey}`
            },
            body: JSON.stringify(payload)
          })
        }
      } else {
        resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        })
      }
      const text = await resp.text()
      const h = new Headers({ 'Content-Type': 'application/json' }); setCORS(h)
      return new Response(text, { status: resp.status, headers: h })
    }
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    })
  }
}
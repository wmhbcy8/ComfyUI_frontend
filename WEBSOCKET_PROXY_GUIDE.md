# ComfyUI WebSocket 代理指南

本指南说明如何在 Editor-only 模式下，通过父页面代理后端 WebSocket 事件到 ComfyUI iframe。

## 架构

```
┌─────────────────┐
│  后端 WebSocket │
│   (ws://...)    │
└────────┬────────┘
         │ 1. 连接并监听
         ↓
┌─────────────────┐
│   父页面         │
│  (Proxy)        │
└────────┬────────┘
         │ 2. postMessage 转发
         ↓
┌─────────────────┐
│  ComfyUI iframe │
│  (接收事件)     │
└─────────────────┘
```

## 父页面实现

### 完整的代理类

```javascript
class ComfyWebSocketProxy {
  constructor(iframeUrl, wsUrl, options = {}) {
    this.iframe = null
    this.ws = null
    this.iframeUrl = iframeUrl
    this.wsUrl = wsUrl
    this.clientId = null
    this.reconnectDelay = options.reconnectDelay || 3000
    this.messageQueue = []
    this.isReady = false
  }

  init() {
    // 1. 创建并插入 iframe
    this.createIframe()

    // 2. 连接 WebSocket
    this.connectWebSocket()

    // 3. 监听来自 iframe 的消息
    this.setupMessageListener()
  }

  createIframe() {
    this.iframe = document.createElement('iframe')
    this.iframe.src = this.iframeUrl
    this.iframe.style.width = '100%'
    this.iframe.style.height = '100%'
    this.iframe.style.border = 'none'
    document.body.appendChild(this.iframe)

    console.log('[Proxy] Iframe created:', this.iframeUrl)
  }

  connectWebSocket() {
    this.ws = new WebSocket(this.wsUrl)

    this.ws.onopen = () => {
      console.log('[Proxy] WebSocket connected')

      // 请求客户端 ID
      this.send({ type: 'getClientId' })
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('[Proxy] WS received:', message.type)

        // 处理 status 消息
        if (message.type === 'status') {
          this.clientId = message.data?.client_id?.id
          this.isReady = true
          console.log('[Proxy] Client ID:', this.clientId)

          // 发送队列中的消息
          this.flushMessageQueue()
          return
        }

        // 转发所有其他消息到 iframe
        this.forwardToIframe(message)
      } catch (error) {
        console.error('[Proxy] Failed to parse message:', error)
      }
    }

    this.ws.onerror = (error) => {
      console.error('[Proxy] WebSocket error:', error)
    }

    this.ws.onclose = () => {
      console.log('[Proxy] WebSocket closed, reconnecting...')
      this.isReady = false
      setTimeout(() => this.connectWebSocket(), this.reconnectDelay)
    }
  }

  forwardToIframe(message) {
    if (!this.iframe || !this.iframe.contentWindow) {
      console.warn('[Proxy] Iframe not ready')
      return
    }

    // 发送完整的 WebSocket 消息（包含 type 和 data）
    // 注意：必须保持原始消息结构，iframe 会根据事件类型进行相应处理
    this.iframe.contentWindow.postMessage({
      type: 'COMFYUI_WS_EVENT',
      data: message  // 原始 WebSocket 消息：{ type, data }
    }, '*')

    console.log('[Proxy] Forwarded to iframe:', message.type)
  }

  setupMessageListener() {
    window.addEventListener('message', (event) => {
      // 验证消息来源
      if (event.source !== this.iframe.contentWindow) return

      const { type, data } = event.data

      switch (type) {
        case 'COMFYUI_QUEUE_PROMPT':
          // 转发队列请求到后端
          this.queuePrompt(data)
          break

        case 'COMFYUI_REQUEST_ID':
          // iframe 请求客户端 ID
          if (this.clientId) {
            this.sendToIframe({
              type: 'COMFYUI_CLIENT_ID',
              clientId: this.clientId
            })
          }
          break
      }
    })
  }

  sendToIframe(message) {
    if (!this.iframe || !this.iframe.contentWindow) return
    this.iframe.contentWindow.postMessage(message, '*')
  }

  queuePrompt(prompt) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Proxy] WebSocket not ready')
      return
    }

    // 添加客户端 ID
    const message = {
      ...prompt,
      client_id: this.clientId
    }

    this.ws.send(JSON.stringify(message))
    console.log('[Proxy] Queued prompt:', message.prompt_id)
  }

  send(message) {
    if (this.isReady) {
      this.ws.send(JSON.stringify(message))
    } else {
      // WebSocket 未就绪，加入队列
      this.messageQueue.push(message)
    }
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      this.ws.send(JSON.stringify(message))
    }
  }

  // 获取客户端 ID（供外部使用）
  getClientId() {
    return this.clientId
  }
}

// 使用示例
const proxy = new ComfyWebSocketProxy(
  'http://localhost:5173/',        // ComfyUI iframe URL
  'ws://localhost:8188/ws',       // 后端 WebSocket URL
  { reconnectDelay: 3000 }
)

proxy.init()

// 监听就绪状态
proxy.onReady = () => {
  console.log('Proxy ready, client ID:', proxy.getClientId())
}
```

## ComfyUI iframe 端

iframe 端的代码已经实现在 `workflowIntegrationService.ts` 中：

```typescript
private handleWsEvent(wsMessage: any) {
  if (!wsMessage || !wsMessage.type) return

  const { type, data } = wsMessage

  try {
    // 将 WebSocket 消息转换为 CustomEvent 并分发
    // 这样 executionStore 中的监听器就能正常工作
    api.dispatchCustomEvent(type, data)
  } catch (error) {
    console.error(
      '[WorkflowIntegration] ❌ Failed to dispatch WS event:',
      type,
      error
    )
  }
}
```

## 完整的父页面 HTML 示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ComfyUI WebSocket Proxy</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
    }
    #container {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #toolbar {
      padding: 10px;
      background: #f0f0f0;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    #status {
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 14px;
    }
    .status-connected {
      background: #4CAF50;
      color: white;
    }
    .status-disconnected {
      background: #f44336;
      color: white;
    }
    #iframe-container {
      flex: 1;
      position: relative;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      background: #2196F3;
      color: white;
      cursor: pointer;
    }
    button:hover {
      background: #1976D2;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div id="container">
    <div id="toolbar">
      <div id="status" class="status-disconnected">未连接</div>
      <button id="queue-btn" disabled>执行工作流</button>
      <button id="interrupt-btn" disabled>中断</button>
    </div>
    <div id="iframe-container"></div>
  </div>

  <script>
    // WebSocket 代理配置
    const CONFIG = {
      iframeUrl: 'http://localhost:5173/',
      wsUrl: 'ws://localhost:8188/ws',
      reconnectDelay: 3000
    }

    // 状态
    let proxy = null
    let isExecuting = false

    // 初始化代理
    function initProxy() {
      proxy = new ComfyWebSocketProxy(
        CONFIG.iframeUrl,
        CONFIG.wsUrl,
        { reconnectDelay: CONFIG.reconnectDelay }
      )
      proxy.init()

      // 监听执行状态
      window.addEventListener('message', (event) => {
        const { type } = event.data

        switch (type) {
          case 'COMFYUI_EXECUTION_START':
            isExecuting = true
            updateUI()
            break

          case 'COMFYUI_EXECUTION_SUCCESS':
          case 'COMFYUI_EXECUTION_ERROR':
            isExecuting = false
            updateUI()
            break
        }
      })
    }

    // 更新 UI
    function updateUI() {
      const statusEl = document.getElementById('status')
      const queueBtn = document.getElementById('queue-btn')
      const interruptBtn = document.getElementById('interrupt-btn')

      if (proxy.isReady) {
        statusEl.textContent = '已连接'
        statusEl.className = 'status-connected'
      } else {
        statusEl.textContent = '未连接'
        statusEl.className = 'status-disconnected'
      }

      queueBtn.disabled = !proxy.isReady || isExecuting
      interruptBtn.disabled = !isExecuting
    }

    // 定期更新状态
    setInterval(updateUI, 1000)

    // 执行工作流
    document.getElementById('queue-btn').addEventListener('click', () => {
      // 请求当前工作流的 API 格式
      const iframe = document.querySelector('iframe')
      iframe.contentWindow.postMessage({
        type: 'COMFYUI_REQUEST_WORKFLOW_JSON',
        source: 'queue'
      }, '*')
    })

    // 中断执行
    document.getElementById('interrupt-btn').addEventListener('click', () => {
      if (proxy.ws && proxy.ws.readyState === WebSocket.OPEN) {
        proxy.ws.send(JSON.stringify({ type: 'interrupt' }))
      }
    })

    // 监听工作流 JSON 响应
    window.addEventListener('message', (event) => {
      if (event.data.type === 'COMFYUI_WORKFLOW_JSON_RESPONSE') {
        const { workflowApiJson } = event.data
        const prompt = JSON.parse(workflowApiJson)

        // 发送到队列
        if (proxy.ws && proxy.ws.readyState === WebSocket.OPEN) {
          proxy.ws.send(JSON.stringify({
            type: 'queue',
            prompt: prompt,
            client_id: proxy.getClientId()
          }))
        }
      }
    })

    // 启动
    initProxy()
  </script>
</body>
</html>
```

## 数据流示例

### 1. 节点执行进度

```
后端 WebSocket:
{
  "type": "progress",
  "data": {
    "node": "1",
    "value": 50,
    "max": 100,
    "prompt_id": "uuid"
  }
}
     ↓
父页面接收并转发:
{
  "type": "COMFYUI_WS_EVENT",
  "data": {
    "type": "progress",
    "node": "1",
    "value": 50,
    "max": 100,
    "prompt_id": "uuid"
  }
}
     ↓
ComfyUI iframe 接收:
api.dispatchCustomEvent('progress', data)
     ↓
executionStore.handleProgress()
     ↓
节点 UI 更新进度条
```

### 2. 节点执行完成

```
后端:
{
  "type": "executed",
  "data": {
    "node": "1",
    "prompt_id": "uuid",
    "output": { ... }
  }
}
     ↓
[转发过程]
     ↓
executionStore.handleExecuted()
     ↓
节点显示完成状态
```

## 调试技巧

### 1. 查看代理日志

```javascript
// 在父页面的浏览器控制台中
localStorage.setItem('DEBUG', 'true')
```

### 2. 监控所有事件

```javascript
// 在父页面添加
proxy.ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  console.table({
    type: message.type,
    hasData: !!message.data,
    timestamp: new Date().toISOString()
  })
  // ... 转发逻辑
}
```

### 3. 验证事件到达

在 ComfyUI iframe 中添加日志：

```typescript
private handleWsEvent(wsMessage: any) {
  console.log('[Iframe] WS event received:', wsMessage.type)
  // ...
}
```

## 性能优化

### 1. 消息节流

对于高频事件（如 `progress`），可以添加节流：

```javascript
class ThrottledProxy extends ComfyWebSocketProxy {
  constructor(...args) {
    super(...args)
    this.throttleTimers = {}
  }

  forwardToIframe(message) {
    // 对 progress 事件进行节流
    if (message.type === 'progress') {
      const key = `${message.data.node}_${message.data.prompt_id}`
      if (this.throttleTimers[key]) return

      this.throttleTimers[key] = setTimeout(() => {
        delete this.throttleTimers[key]
      }, 100) // 100ms 节流
    }

    super.forwardToIframe(message)
  }
}
```

### 2. 批量转发

```javascript
forwardToIframe(message) {
  if (!this.messageBuffer) {
    this.messageBuffer = []
    setTimeout(() => this.flushBuffer(), 16) // ~60fps
  }

  this.messageBuffer.push(message)
}

flushBuffer() {
  if (!this.iframe || !this.messageBuffer?.length) return

  this.iframe.contentWindow.postMessage({
    type: 'COMFYUI_WS_EVENT_BATCH',
    data: this.messageBuffer
  }, '*')

  this.messageBuffer = []
}
```

## 故障排除

### 问题：iframe 接收不到事件

**检查清单：**
1. 验证 postMessage 的 origin
2. 确认 iframe 已加载完成
3. 检查浏览器控制台是否有错误

### 问题：事件格式不正确

**解决方案：**
确保转发的是完整的 WebSocket 消息对象，包含 `type` 和 `data` 字段。

### 问题：执行状态不同步

**解决方案：**
1. 检查 `client_id` 是否正确设置
2. 确认消息顺序是否正确
3. 添加日志追踪消息流

## 总结

这个方案的优点：
1. ✅ ComfyUI 完全不需要直接连接后端
2. ✅ 父页面完全控制 WebSocket 连接
3. ✅ 前端 UI 逻辑无需修改，正常工作
4. ✅ 支持所有后端事件类型

适用场景：
- Editor-only 模式
- 需要集中管理 WebSocket 连接
- 需要在父页面监控和记录执行状态

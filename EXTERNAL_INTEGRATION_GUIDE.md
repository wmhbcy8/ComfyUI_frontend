# ComfyUI iframe 嵌入集成指南

本指南说明如何在你的业务前端中嵌入 ComfyUI 编辑器，并通过 postMessage 进行数据交互。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [认证方式](#认证方式)
3. [工作流数据交互](#工作流数据交互)
4. [消息协议](#消息协议)
5. [调试工具](#调试工具)
6. [完整示例](#完整示例)
7. [故障排除](#故障排除)

---

## 快速开始

### 基本嵌入

```html
<iframe
  id="comfyui-iframe"
  src="http://localhost:5173/"
  width="100%"
  height="800px"
></iframe>
```

### 启用 Editor-Only 模式

在 `.env` 文件中配置：

```bash
EDITOR_ONLY_MODE=true
```

然后重新构建前端。

---

## 认证方式

ComfyUI 支持两种认证方式，用于接收父页面发送的工作流数据时的验证：

### 方式 1：URL 参数传递（快速测试）

```html
<iframe
  src="http://localhost:5173/?token=your-auth-token-here"
  width="100%"
  height="800px"
></iframe>
```

**优点：**
- ✅ 简单直接，无需额外代码
- ✅ 快速验证集成方案

**缺点：**
- ⚠️ Token 会出现在浏览器历史记录中
- ⚠️ 不适合生产环境

---

### 方式 2：postMessage 传递（生产环境推荐）

**更安全**，适合生产环境。

#### 基础实现

**父页面代码：**

```javascript
// 1. 等待 iframe 加载完成
const iframe = document.getElementById('comfyui-iframe')

iframe.onload = () => {
  // 2. 发送认证 token
  iframe.contentWindow.postMessage(
    {
      type: 'COMFYUI_AUTH',
      token: 'your-auth-token-here'
    },
    '*' // 生产环境应该指定具体的 origin
  )

  console.log('[Parent] Auth token sent to ComfyUI')
}

// 3. 监听 ComfyUI 的响应
window.addEventListener('message', (event) => {
  // 忽略来自其他窗口的消息
  if (event.source !== iframe.contentWindow) return

  const { type, data } = event.data

  switch (type) {
    case 'COMFYUI_AUTH_ACK':
      console.log('[Parent] Auth acknowledged by ComfyUI:', data)
      break

    case 'COMFYUI_WORKFLOW_CHANGE': {
      const canvasWorkflow = JSON.parse(data.workflowJson)
      const apiWorkflow = JSON.parse(data.workflowApiJson)
      console.log('[Parent] Workflow changed:', { canvasWorkflow, apiWorkflow })
      // 处理工作流变化
      saveWorkflowToYourBackend(canvasWorkflow)
      // 或者直接使用 apiWorkflow 执行
      break
    }

    case 'COMFYUI_WORKFLOW_JSON_RESPONSE': {
      const canvasWorkflow = JSON.parse(data.workflowJson)
      const apiWorkflow = JSON.parse(data.workflowApiJson)
      console.log('[Parent] Canvas format:', canvasWorkflow)
      console.log('[Parent] API format:', apiWorkflow)
      break
    }

    case 'COMFYUI_LOAD_WORKFLOW_ACK':
      console.log('[Parent] Load workflow result:', data)
      break
  }
})
```

#### 更安全的实现（验证 origin）

```javascript
const ALLOWED_ORIGIN = 'https://your-comfyui-domain.com'

iframe.contentWindow.postMessage(
  {
    type: 'COMFYUI_AUTH',
    token: 'your-auth-token-here'
  },
  ALLOWED_ORIGIN // 只发送到指定的 origin
)

window.addEventListener('message', (event) => {
  // 验证消息来源
  if (event.origin !== ALLOWED_ORIGIN) return
  if (event.source !== iframe.contentWindow) return

  // 处理消息...
})
```

---

## 工作流数据交互

### 工作流数据格式

当用户在 ComfyUI 中编辑工作流时，前端会通过 postMessage 发送工作流数据到父页面。

**消息格式：**

```javascript
{
  type: 'COMFYUI_WORKFLOW_CHANGE',
  workflowJson: '{"version":0.4,"nodes":[...],...}', // JSON 字符串
  timestamp: 1704800000000
}
```

**workflowJson 是字符串，需要解析：**

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'COMFYUI_WORKFLOW_CHANGE') {
    const workflowData = JSON.parse(event.data.workflowJson)
    console.log('Nodes count:', workflowData.nodes.length)
    console.log('Links count:', workflowData.links.length)
  }
})
```

### 工作流数据结构

#### Canvas 格式（用于编辑）

`workflowJson` 包含完整的画布信息，适合编辑和可视化：

```json
{
  "version": 0.4,
  "nodes": [
    {
      "id": 1,
      "type": "KSampler",
      "pos": [100, 200],
      "size": [300, 400],
      "flags": {},
      "order": 0,
      "mode": 0,
      "outputs": [],
      "inputs": [],
      "properties": {},
      "widgets_values": []
    }
  ],
  "links": [
    [1, 0, 1, 0, "LATENT"]
  ],
  "groups": [],
  "extra": {}
}
```

#### API 格式（用于执行）

`workflowApiJson` 是后端执行格式，可直接用于队列提交：

```json
{
  "1": {
    "inputs": {
      "seed": 123456,
      "steps": 20,
      "cfg": 7,
      "sampler_name": "euler",
      "scheduler": "normal",
      "model": ["4", 0],
      "positive": ["2", 0],
      "negative": ["3", 0],
      "latent_image": ["5", 0]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "KSampler"
    }
  },
  "2": {
    "inputs": {
      "text": "positive prompt"
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "Positive Prompt"
    }
  }
}
```

**关键区别：**
- Canvas 格式包含 UI 信息（位置、尺寸、颜色）
- API 格式只包含执行所需的数据
- API 格式中节点连接用 `[nodeId, slotIndex]` 表示

---

## 消息协议

### 父页面 → ComfyUI

#### 1. 加载工作流

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_LOAD_WORKFLOW',
  workflowJson: '{"version":0.4,"nodes":[...]}', // JSON 字符串或对象
  workflowId: 'optional-workflow-id'
}, '*')
```

**响应：**
```javascript
{
  type: 'COMFYUI_LOAD_WORKFLOW_ACK',
  workflowId: 'optional-workflow-id',
  success: true,
  timestamp: 1704800000000
}
```

#### 2. 请求工作流 JSON

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_REQUEST_WORKFLOW_JSON',
  source: 'manual' // 可选，用于标识请求来源
}, '*')
```

**响应：**
```javascript
{
  type: 'COMFYUI_WORKFLOW_JSON_RESPONSE',
  workflowJson: '{"version":0.4,"nodes":[...]}',
  workflowApiJson: '{"1":{"inputs":{...},"class_type":"KSampler"}}',
  source: 'manual',
  timestamp: 1704800000000
}
```

**字段说明：**
- `workflowJson` - Canvas 格式（用于编辑），包含节点位置、尺寸等 UI 信息
- `workflowApiJson` - API 格式（用于执行），包含节点输入值和连接关系，可直接用于队列执行

#### 3. 清空画布

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_CLEAR_CANVAS'
}, '*')
```

**响应：**
```javascript
{
  type: 'COMFYUI_CLEAR_CANVAS_ACK',
  success: true,
  timestamp: 1704800000000
}
```

#### 4. 重置视图

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_RESET_VIEW'
}, '*')
```

**响应：**
```javascript
{
  type: 'COMFYUI_RESET_VIEW_ACK',
  success: true,
  timestamp: 1704800000000
}
```

#### 5. 发送认证 Token

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_AUTH',
  token: 'your-auth-token-here'
}, '*')
```

**响应：**
```javascript
{
  type: 'COMFYUI_AUTH_ACK',
  success: true,
  timestamp: 1704800000000
}
```

#### 6. 切换语言

```javascript
iframe.contentWindow.postMessage({
  type: 'COMFYUI_SET_LOCALE',
  locale: 'zh' // 语言代码
}, '*')
```

**支持的语言代码：**
- `en` - English
- `zh` - 中文
- `zh-TW` - 繁體中文
- `ru` - Русский
- `ja` - 日本語
- `ko` - 한국어
- `fr` - Français
- `es` - Español
- `ar` - عربي
- `tr` - Türkçe
- `pt-BR` - Português (BR)

**响应：**
```javascript
{
  type: 'COMFYUI_SET_LOCALE_ACK',
  locale: 'zh',
  success: true,
  timestamp: 1704800000000
}
```

**失败响应：**
```javascript
{
  type: 'COMFYUI_SET_LOCALE_ACK',
  locale: 'xx',
  success: false,
  error: 'Unsupported locale: "xx". Supported locales: en, zh, zh-TW, ...',
  timestamp: 1704800000000
}
```

### ComfyUI → 父页面

#### 1. 工作流变化

当用户在 ComfyUI 中编辑工作流时，会自动发送此事件（防抖 1 秒）：

```javascript
{
  type: 'COMFYUI_WORKFLOW_CHANGE',
  workflowJson: '{"version":0.4,"nodes":[...]}',
  workflowApiJson: '{"1":{"inputs":{...},"class_type":"KSampler"}}',
  timestamp: 1704800000000
}
```

**字段说明：**
- `workflowJson` - Canvas 格式（用于编辑），包含节点位置、尺寸等 UI 信息
- `workflowApiJson` - API 格式（用于执行），包含节点输入值和连接关系

#### 2. Auth Ready（iframe 初始化完成）

```javascript
{
  type: 'COMFYUI_AUTH_READY',
  timestamp: 1704800000000
}
```

#### 3. 执行开始

当工作流开始执行时发送：

```javascript
{
  type: 'COMFYUI_EXECUTION_START',
  promptId: 'uuid-string',
  timestamp: 1704800000000
}
```

#### 4. 节点开始执行

当某个节点开始执行时发送：

```javascript
{
  type: 'COMFYUI_NODE_EXECUTING',
  nodeId: '1',
  promptId: 'uuid-string',
  timestamp: 1704800000000
}
```

#### 5. 节点进度更新

当正在执行的节点有进度更新时发送（频繁发送）：

```javascript
{
  type: 'COMFYUI_NODE_PROGRESS',
  nodeId: '1',
  value: 50,
  max: 100,
  promptId: 'uuid-string',
  timestamp: 1704800000000
}
```

#### 6. 节点执行完成

当某个节点执行完成时发送：

```javascript
{
  type: 'COMFYUI_NODE_EXECUTED',
  nodeId: '1',
  promptId: 'uuid-string',
  output: { /* 节点输出数据 */ },
  timestamp: 1704800000000
}
```

#### 7. 执行缓存

某些节点使用了缓存结果时发送：

```javascript
{
  type: 'COMFYUI_EXECUTION_CACHED',
  promptId: 'uuid-string',
  nodes: ['1', '2', '3'], // 使用缓存的节点 ID 列表
  timestamp: 1704800000000
}
```

#### 8. 执行成功

整个工作流执行成功完成时发送：

```javascript
{
  type: 'COMFYUI_EXECUTION_SUCCESS',
  promptId: 'uuid-string',
  timestamp: 1704800000000
}
```

#### 9. 执行错误

工作流执行出错时发送：

```javascript
{
  type: 'COMFYUI_EXECUTION_ERROR',
  promptId: 'uuid-string',
  nodeId: '1',
  nodeType: 'KSampler',
  error: 'Error message here',
  timestamp: 1704800000000
}
```

---

## 执行状态监听

父页面可以实时监听工作流的执行状态。以下是一个完整的执行状态监听示例：

```javascript
// 存储执行状态
const executionState = {
  isExecuting: false,
  currentPromptId: null,
  executingNodeId: null,
  nodeProgress: {},
  completedNodes: new Set(),
  totalNodes: 0
}

// 监听所有执行相关事件
window.addEventListener('message', (event) => {
  // 验证来源
  if (event.origin !== ALLOWED_ORIGIN) return
  if (event.source !== iframe.contentWindow) return

  const { type } = event.data

  switch (type) {
    case 'COMFYUI_EXECUTION_START':
      executionState.isExecuting = true
      executionState.currentPromptId = event.data.promptId
      executionState.completedNodes.clear()
      addLog(`🚀 工作流开始执行: ${event.data.promptId}`)
      break

    case 'COMFYUI_NODE_EXECUTING':
      executionState.executingNodeId = event.data.nodeId
      addLog(`⚡ 节点 ${event.data.nodeId} 开始执行`)
      break

    case 'COMFYUI_NODE_PROGRESS': {
      const { nodeId, value, max } = event.data
      const percentage = Math.round((value / max) * 100)
      executionState.nodeProgress[nodeId] = { value, max, percentage }
      addLog(`📊 节点 ${nodeId} 进度: ${percentage}%`)
      break
    }

    case 'COMFYUI_NODE_EXECUTED': {
      const nodeId = event.data.nodeId
      executionState.completedNodes.add(nodeId)
      delete executionState.nodeProgress[nodeId]
      const completed = executionState.completedNodes.size
      addLog(`✅ 节点 ${nodeId} 完成 (${completed}/${executionState.totalNodes})`)
      break
    }

    case 'COMFYUI_EXECUTION_CACHED': {
      event.data.nodes.forEach(nodeId => {
        executionState.completedNodes.add(nodeId)
      })
      addLog(`💾 ${event.data.nodes.length} 个节点使用缓存`)
      break
    }

    case 'COMFYUI_EXECUTION_SUCCESS':
      executionState.isExecuting = false
      executionState.executingNodeId = null
      addLog(`🎉 工作流执行成功!`)
      break

    case 'COMFYUI_EXECUTION_ERROR':
      executionState.isExecuting = false
      executionState.executingNodeId = null
      addLog(`❌ 执行错误 - 节点 ${event.data.nodeId} (${event.data.nodeType}): ${event.data.error}`)
      break
  }
})
```

### 使用示例：显示执行进度

```html
<!DOCTYPE html>
<html>
<head>
  <title>ComfyUI 执行状态监听</title>
  <style>
    #execution-status {
      padding: 10px;
      background: #f5f5f5;
      margin-top: 20px;
    }
    .progress-bar {
      width: 100%;
      height: 20px;
      background: #ddd;
      border-radius: 10px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      transition: width 0.3s;
    }
    .node-status {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }
    .node {
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 12px;
    }
    .node.executing {
      background: #FFC107;
      animation: pulse 1s infinite;
    }
    .node.completed {
      background: #4CAF50;
      color: white;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <iframe id="comfyui-iframe" src="http://localhost:5173/"></iframe>

  <div id="execution-status">
    <h3>执行状态</h3>
    <div class="progress-bar">
      <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
    </div>
    <div id="progress-text">等待执行...</div>
    <div class="node-status" id="node-status"></div>
  </div>

  <script>
    const iframe = document.getElementById('comfyui-iframe')
    const ALLOWED_ORIGIN = 'http://localhost:5173'

    const state = {
      totalNodes: 0,
      completedNodes: new Set(),
      executingNodeId: null
    }

    window.addEventListener('message', (event) => {
      if (event.origin !== ALLOWED_ORIGIN) return
      if (event.source !== iframe.contentWindow) return

      const { type } = event.data
      const progressFill = document.getElementById('progress-fill')
      const progressText = document.getElementById('progress-text')
      const nodeStatus = document.getElementById('node-status')

      switch (type) {
        case 'COMFYUI_EXECUTION_START':
          progressText.textContent = '执行中...'
          break

        case 'COMFYUI_EXECUTION_CACHED':
          event.data.nodes.forEach(id => state.completedNodes.add(id))
          updateProgress()
          break

        case 'COMFYUI_NODE_EXECUTING':
          state.executingNodeId = event.data.nodeId
          updateNodeStatus()
          break

        case 'COMFYUI_NODE_EXECUTED':
          state.completedNodes.add(event.data.nodeId)
          state.executingNodeId = null
          updateProgress()
          updateNodeStatus()
          break

        case 'COMFYUI_EXECUTION_SUCCESS':
          progressText.textContent = '✅ 执行完成!'
          progressFill.style.width = '100%'
          state.executingNodeId = null
          updateNodeStatus()
          break

        case 'COMFYUI_EXECUTION_ERROR':
          progressText.textContent = `❌ 错误: ${event.data.error}`
          state.executingNodeId = null
          updateNodeStatus()
          break
      }
    })

    function updateProgress() {
      const progressFill = document.getElementById('progress-fill')
      const progressText = document.getElementById('progress-text')
      const percentage = (state.completedNodes.size / state.totalNodes) * 100
      progressFill.style.width = percentage + '%'
      progressText.textContent = `${state.completedNodes.size}/${state.totalNodes} 节点完成`
    }

    function updateNodeStatus() {
      const nodeStatus = document.getElementById('node-status')
      nodeStatus.innerHTML = ''

      // 显示执行中的节点
      if (state.executingNodeId) {
        const div = document.createElement('div')
        div.className = 'node executing'
        div.textContent = `节点 ${state.executingNodeId} 执行中`
        nodeStatus.appendChild(div)
      }

      // 显示已完成的节点（最多显示5个）
      const completed = Array.from(state.completedNodes).slice(-5)
      completed.forEach(nodeId => {
        const div = document.createElement('div')
        div.className = 'node completed'
        div.textContent = `节点 ${nodeId}`
        nodeStatus.appendChild(div)
      })
    }
  </script>
</body>
</html>
```

### 执行状态事件总结

| 事件名 | 触发时机 | 使用场景 |
|--------|---------|---------|
| `COMFYUI_EXECUTION_START` | 工作流开始执行 | 初始化进度 UI，设置执行标志 |
| `COMFYUI_NODE_EXECUTING` | 节点开始执行 | 高亮显示当前执行的节点 |
| `COMFYUI_NODE_PROGRESS` | 节点执行进度更新 | 显示进度条、百分比 |
| `COMFYUI_NODE_EXECUTED` | 节点执行完成 | 更新完成计数，移除高亮 |
| `COMFYUI_EXECUTION_CACHED` | 节点使用缓存 | 标记节点已完成，不执行 |
| `COMFYUI_EXECUTION_SUCCESS` | 工作流执行成功 | 显示成功消息，清理状态 |
| `COMFYUI_EXECUTION_ERROR` | 工作流执行失败 | 显示错误信息，高亮错误节点 |

---

## 调试工具

### 查看 Token 状态

ComfyUI 提供了浏览器控制台调试工具：

#### 方法 1：浏览器控制台（推荐）

在 ComfyUI 页面的控制台中输入：

```javascript
window.comfyUIAuthTokenInfo()
```

**返回示例：**

```javascript
{
  hasToken: true,
  source: 'dynamic (URL/postMessage)',
  tokenType: 'Custom',
  preview: 'your-to...'
}
```

#### 方法 2：查看日志

打开浏览器控制台，查找 `[AuthToken]` 前缀的日志：

```
[AuthToken] 🚀 AuthTokenManager initializing...
[AuthToken] 📊 Initial token status: { hasToken: true, source: '...', ... }
[AuthToken] 📤 Sent AUTH_READY to parent
```

### 验证步骤

#### 1️⃣ 测试 postMessage 通信

**父页面：**

```javascript
const iframe = document.getElementById('comfyui-iframe')

// 监听所有消息
window.addEventListener('message', (event) => {
  console.log('[Parent] Message received:', event.data)
})

// 发送测试消息
iframe.contentWindow.postMessage({
  type: 'COMFYUI_AUTH',
  token: 'test-token-12345'
}, '*')
```

**预期结果：**

1. ComfyUI 控制台应该显示：
```
[AuthToken] 📩 Message received: ...
[AuthToken] ✅ Token loaded from postMessage
[AuthToken] 📤 Sent ACK to parent
```

2. 父页面控制台应该收到：
```javascript
{
  type: 'COMFYUI_AUTH_ACK',
  success: true,
  timestamp: 1704800000000
}
```

#### 2️⃣ 测试工作流同步

1. 在 ComfyUI 中添加或删除节点
2. 父页面应该收到 `COMFYUI_WORKFLOW_CHANGE` 消息
3. 解析 `workflowJson` 并验证数据

---

## 完整示例

### 父页面完整代码

```html
<!DOCTYPE html>
<html>
<head>
  <title>ComfyUI 集成示例</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
    }
    #comfyui-container {
      width: 100%;
      height: 800px;
      border: 1px solid #ccc;
    }
    #controls {
      margin-bottom: 20px;
      padding: 10px;
      background: #f5f5f5;
    }
    button {
      margin-right: 10px;
      padding: 8px 16px;
    }
    #log {
      margin-top: 20px;
      padding: 10px;
      background: #f9f9f9;
      border: 1px solid #ddd;
      height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>ComfyUI iframe 嵌入示例</h1>

  <div id="controls">
    <button onclick="sendAuth()">发送认证</button>
    <button onclick="requestWorkflow()">请求工作流</button>
    <button onclick="clearCanvas()">清空画布</button>
    <button onclick="resetView()">重置视图</button>
    <select id="locale-select" onchange="setLocale(this.value)">
      <option value="">选择语言</option>
      <option value="en">English</option>
      <option value="zh">中文</option>
      <option value="zh-TW">繁體中文</option>
      <option value="ru">Русский</option>
      <option value="ja">日本語</option>
      <option value="ko">한국어</option>
      <option value="fr">Français</option>
      <option value="es">Español</option>
      <option value="ar">عربي</option>
      <option value="tr">Türkçe</option>
      <option value="pt-BR">Português (BR)</option>
    </select>
  </div>

  <div id="comfyui-container">
    <iframe
      id="comfyui-iframe"
      src="http://localhost:5173/"
      width="100%"
      height="100%"
    ></iframe>
  </div>

  <div id="log"></div>

  <script>
    const iframe = document.getElementById('comfyui-iframe')
    const log = document.getElementById('log')
    const ALLOWED_ORIGIN = 'http://localhost:5173'

    function addLog(message) {
      const time = new Date().toLocaleTimeString()
      log.innerHTML += `[${time}] ${message}\n`
      log.scrollTop = log.scrollHeight
    }

    // 发送认证 token
    function sendAuth() {
      iframe.contentWindow.postMessage({
        type: 'COMFYUI_AUTH',
        token: 'test-token-12345'
      }, ALLOWED_ORIGIN)
      addLog('发送认证 token')
    }

    // 请求工作流
    function requestWorkflow() {
      iframe.contentWindow.postMessage({
        type: 'COMFYUI_REQUEST_WORKFLOW_JSON',
        source: 'manual'
      }, ALLOWED_ORIGIN)
      addLog('请求工作流 JSON')
    }

    // 清空画布
    function clearCanvas() {
      iframe.contentWindow.postMessage({
        type: 'COMFYUI_CLEAR_CANVAS'
      }, ALLOWED_ORIGIN)
      addLog('清空画布')
    }

    // 重置视图
    function resetView() {
      iframe.contentWindow.postMessage({
        type: 'COMFYUI_RESET_VIEW'
      }, ALLOWED_ORIGIN)
      addLog('重置视图')
    }

    // 切换语言
    function setLocale(locale) {
      if (!locale) return

      iframe.contentWindow.postMessage({
        type: 'COMFYUI_SET_LOCALE',
        locale: locale
      }, ALLOWED_ORIGIN)
      addLog(`切换语言到: ${locale}`)
    }

    // 监听来自 ComfyUI 的消息
    window.addEventListener('message', (event) => {
      // 验证来源
      if (event.origin !== ALLOWED_ORIGIN) return
      if (event.source !== iframe.contentWindow) return

      const { type, data } = event.data

      switch (type) {
        case 'COMFYUI_AUTH_ACK':
          addLog(`✅ 认证成功: ${data.success}`)
          break

        case 'COMFYUI_AUTH_READY':
          addLog('🚀 ComfyUI 已准备就绪')
          // 自动发送认证
          sendAuth()
          break

        case 'COMFYUI_WORKFLOW_CHANGE': {
          const canvasWorkflow = JSON.parse(data.workflowJson)
          const apiWorkflow = JSON.parse(data.workflowApiJson)
          addLog(`📊 工作流变化: ${canvasWorkflow.nodes.length} 个节点`)
          addLog(`✅ API 格式: ${Object.keys(apiWorkflow).length} 个可执行节点`)
          // 保存到你的后端
          // saveWorkflowToBackend(data.workflowJson)
          // 或者直接使用 apiWorkflow 执行
          break
        }

        case 'COMFYUI_WORKFLOW_JSON_RESPONSE':
          if (data.error) {
            addLog(`❌ 获取工作流失败: ${data.error}`)
          } else {
            const canvasWorkflow = JSON.parse(data.workflowJson)
            const apiWorkflow = JSON.parse(data.workflowApiJson)
            addLog(`✅ 收到 Canvas 格式: ${canvasWorkflow.nodes.length} 个节点`)
            addLog(`✅ 收到 API 格式: ${Object.keys(apiWorkflow).length} 个可执行节点`)
            // 使用 canvasWorkflow 进行编辑
            // 使用 apiWorkflow 直接提交执行
          }
          break

        case 'COMFYUI_CLEAR_CANVAS_ACK':
          addLog(`✅ 画布已清空: ${data.success}`)
          break

        case 'COMFYUI_RESET_VIEW_ACK':
          addLog(`✅ 视图已重置: ${data.success}`)
          break

        case 'COMFYUI_SET_LOCALE_ACK':
          if (data.success) {
            addLog(`✅ 语言已切换: ${data.locale}`)
          } else {
            addLog(`❌ 切换语言失败: ${data.error}`)
          }
          break

        default:
          addLog(`📩 未知消息类型: ${type}`)
      }
    })

    // iframe 加载完成
    iframe.onload = () => {
      addLog('✅ ComfyUI iframe 已加载')
    }
  </script>
</body>
</html>
```

---

## 故障排除

### 问题 1：没有看到 `[AuthToken]` 日志

**原因：** iframe 未正确加载或页面未在 Editor-Only 模式下运行

**解决方案：**

1. 确认 Editor-Only 模式已启用：
```bash
# .env
EDITOR_ONLY_MODE=true
```

2. 重新构建前端

3. 在 ComfyUI 控制台检查：
```javascript
window.location.search
```

### 问题 2：postMessage 没有被接收

**检查清单：**

1. **验证消息格式：**
```javascript
// 必须包含 type 字段
{
  type: 'COMFYUI_AUTH', // 正确
  token: 'xxx'
}
```

2. **检查父页面的消息监听器：**
```javascript
window.addEventListener('message', (event) => {
  console.log('Message received:', event.data)
})
```

3. **验证 origin：**
```javascript
// ComfyUI 控制台
console.log(window.location.origin) // 应该是 http://localhost:5173
```

### 问题 3：工作流数据未同步

**调试步骤：**

1. 在 ComfyUI 控制台查看是否有 `[WorkflowIntegration]` 日志：
```
[WorkflowIntegration] 🚀 Initializing workflow integration service...
[WorkflowIntegration] ✅ Initialized
[WorkflowIntegration] 🎤 Listening to graphChanged events
```

2. 检查是否在 iframe 中：
```javascript
// ComfyUI 控制台
console.log(window.parent !== window) // 应该是 true
```

3. 手动触发工作流同步：
```javascript
// 父页面
iframe.contentWindow.postMessage({
  type: 'COMFYUI_REQUEST_WORKFLOW_JSON',
  source: 'debug'
}, '*')
```

---

## 安全建议

1. **始终验证 event.origin：**
```javascript
const ALLOWED_ORIGIN = 'https://your-comfyui-domain.com'
if (event.origin !== ALLOWED_ORIGIN) return
```

2. **使用 HTTPS：** 生产环境必须使用 HTTPS

3. **Token 管理：**
   - 使用短期有效的 token
   - 实施 token 刷新机制
   - 不要在 URL 中传递敏感 token

4. **CORS 配置：** 确保 ComfyUI 服务器正确配置 CORS

---

## 更多资源

- ComfyUI 官方文档：https://docs.comfy.org
- postMessage API：https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- iframe 安全最佳实践：https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion

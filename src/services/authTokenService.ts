/**
 * Token 管理服务
 * 支持多种认证方式：
 * 1. URL 参数 (?token=xxx)
 * 2. localStorage (持久化存储)
 * 3. postMessage (iframe 嵌入)
 */

const LOCAL_STORAGE_KEY = 'comfyui_auth_token'

class AuthTokenManager {
  private dynamicToken: string | null = null
  private isIframe: boolean = false

  constructor() {
    this.isIframe = window.parent !== window
    this.initFromLocalStorage()
    this.initFromURL()
    this.initFromPostMessage()

    // 输出初始状态并发送 AUTH_READY 消息
    setTimeout(() => {
      // 发送 AUTH_READY 消息到父页面
      this.sendAuthReady()
    }, 100)
  }

  /**
   * 从 localStorage 获取 token
   */
  private initFromLocalStorage() {
    try {
      const token = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (token) {
        this.dynamicToken = token
      }
    } catch (error) {
      console.warn('[AuthToken] Failed to read from localStorage:', error)
    }
  }

  /**
   * 从 URL 参数获取 token
   * 示例：http://localhost:5173/?token=your-auth-token
   */
  private initFromURL() {
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')
    if (token) {
      this.dynamicToken = token
      // 同时保存到 localStorage
      this.saveTokenToLocalStorage(token)
    }
  }

  /**
   * 从 postMessage 获取 token（用于 iframe 嵌入）
   * 父页面代码示例：
   * iframe.contentWindow.postMessage({
   *   type: 'COMFYUI_AUTH',
   *   token: 'your-auth-token-here'
   * }, '*');
   */
  private initFromPostMessage() {
    window.addEventListener('message', (event) => {
      // 调试：记录所有收到的消息
      // 安全检查：生产环境应该验证 event.origin
      if (event.data?.type === 'COMFYUI_AUTH' && event.data?.token) {
        this.dynamicToken = event.data.token
        // 保存到 localStorage
        this.saveTokenToLocalStorage(event.data.token)

        // 通知父页面 token 已接收
        ;(event.source as WindowProxy).postMessage(
          {
            type: 'COMFYUI_AUTH_ACK',
            success: true,
            timestamp: Date.now()
          },
          { targetOrigin: event.origin }
        )
      }
    })
  }

  /**
   * 保存 token 到 localStorage
   */
  private saveTokenToLocalStorage(token: string) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, token)
    } catch (error) {
      console.warn('[AuthToken] Failed to save token to localStorage:', error)
    }
  }

  /**
   * 发送 COMFYUI_AUTH_READY 消息到父页面
   */
  private sendAuthReady() {
    // 只在 iframe 嵌入模式下发送
    if (this.isIframe && window.parent) {
      const message = {
        type: 'COMFYUI_AUTH_READY',
        timestamp: Date.now()
      }
      window.parent.postMessage(message, '*')
    }
  }

  /**
   * 获取当前有效的 token
   * 优先级：动态 token (URL/postMessage/localStorage)
   */
  getToken(): string | null {
    // 使用动态设置的 token（URL 或 postMessage 或 localStorage）
    if (this.dynamicToken) {
      return this.dynamicToken
    }

    return null
  }

  /**
   * 手动设置 token（用于高级场景）
   */
  setToken(token: string) {
    this.dynamicToken = token
  }

  /**
   * 清除动态 token
   */
  clearToken() {
    this.dynamicToken = null
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch (error) {
      console.warn(
        '[AuthToken] Failed to clear token from localStorage:',
        error
      )
    }
  }

  /**
   * 检查是否有可用的 token
   */
  hasToken(): boolean {
    return this.getToken() !== null
  }
}

// 单例模式
export const authTokenManager = new AuthTokenManager()

/**
 * 获取认证请求头
 * @returns 包含 Authorization 的请求头对象，如果没有 token 则返回空对象
 */
export const getAuthHeaders = (): Record<string, string> => {
  const token = authTokenManager.getToken()

  if (!token) {
    return {}
  }

  // 支持 Bearer Token 和自定义前缀
  if (token.startsWith('Bearer ')) {
    return { Authorization: token }
  }

  if (token.startsWith('Basic ')) {
    return { Authorization: token }
  }

  // 默认使用 Bearer Token
  return { Authorization: `Bearer ${token}` }
}

/**
 * 获取用于调试的 token 信息（不暴露实际 token 值）
 */
export const getTokenInfo = () => {
  const token = authTokenManager.getToken()

  return {
    hasToken: !!token,
    source: authTokenManager['dynamicToken']
      ? 'dynamic (localStorage/URL/postMessage)'
      : 'none',
    tokenType: token?.startsWith('Bearer ')
      ? 'Bearer'
      : token?.startsWith('Basic ')
        ? 'Basic'
        : token
          ? 'Custom'
          : null,
    // 只显示 token 的前 8 个字符用于调试
    preview: token ? `${token.slice(0, 8)}...` : null
  }
}

// 添加到 window 对象，方便在浏览器控制台调试
if (typeof window !== 'undefined') {
  ;(window as any).comfyUIAuthTokenInfo = getTokenInfo
  ;(window as any).comfyUIAuthTokenManager = authTokenManager
}

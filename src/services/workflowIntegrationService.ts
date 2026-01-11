/**
 * 工作流集成服务
 *
 * 用于 iframe 嵌入场景，处理与父页面的 postMessage 通信：
 * 1. 监听工作流变化并发送 COMFYUI_WORKFLOW_CHANGE 消息
 * 2. 接收 COMFYUI_LOAD_WORKFLOW 消息并加载工作流
 * 3. 发送 COMFYUI_LOAD_WORKFLOW_ACK 确认消息
 *
 * 父页面 → ComfyUI:
 * - COMFYUI_LOAD_WORKFLOW { workflowJson, workflowId }
 * - COMFYUI_SET_LOCALE { locale }
 *
 * ComfyUI → 父页面:
 * - COMFYUI_WORKFLOW_CHANGE { workflowJson, workflowId }
 * - COMFYUI_LOAD_WORKFLOW_ACK { workflowId, success, error? }
 * - COMFYUI_SET_LOCALE_ACK { locale, success, error? }
 */

import { api } from '@/scripts/api'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { loadLocale } from '@/i18n'
import { useSettingStore } from '@/platform/settings/settingStore'

/**
 * 防抖延迟（毫秒）
 * 避免工作流频繁变化时发送过多消息
 * 与父前端的防抖时间保持一致（3秒）
 */
const WORKFLOW_CHANGE_DEBOUNCE_MS = 1000

/**
 * 支持的语言列表
 */
const SUPPORTED_LOCALES = [
  'en',
  'zh',
  'zh-TW',
  'ru',
  'ja',
  'ko',
  'fr',
  'es',
  'ar',
  'tr',
  'pt-BR'
] as const

/**
 * 工作流集成服务类
 */
class WorkflowIntegrationService {
  private isIframe: boolean = false
  private workflowChangeTimer: ReturnType<typeof setTimeout> | null = null
  private isInitialized: boolean = false
  private currentWorkflowId: string | null = null

  /**
   * 初始化工作流集成服务
   */
  init() {
    if (this.isInitialized) {
      return
    }

    this.isIframe = window.parent !== window

    if (!this.isIframe) {
      return
    }

    // 监听工作流变化事件
    this.initWorkflowChangeListener()

    // 监听来自父页面的消息
    this.initPostMessageListener()

    this.isInitialized = true
  }

  /**
   * 监听工作流变化事件
   */
  private initWorkflowChangeListener() {
    api.addEventListener(
      'graphChanged',
      (event: CustomEvent<ComfyWorkflowJSON>) => {
        this.handleWorkflowChange(event.detail)
      }
    )
  }

  /**
   * 处理工作流变化
   * 使用防抖避免频繁发送消息
   */
  private handleWorkflowChange(workflowData: ComfyWorkflowJSON) {
    if (!this.isIframe || !window.parent) {
      return
    }

    // 清除之前的定时器
    if (this.workflowChangeTimer) {
      clearTimeout(this.workflowChangeTimer)
    }

    // 设置新的防抖定时器
    this.workflowChangeTimer = setTimeout(() => {
      this.sendWorkflowChangeMessage(workflowData)
    }, WORKFLOW_CHANGE_DEBOUNCE_MS)
  }

  /**
   * 发送工作流变化消息到父页面
   */
  private sendWorkflowChangeMessage(workflowData: ComfyWorkflowJSON) {
    if (!window.parent) return

    // 序列化为 JSON 字符串（父前端期望字符串格式）
    const workflowJsonString = JSON.stringify(workflowData)

    const message = {
      type: 'COMFYUI_WORKFLOW_CHANGE',
      workflowJson: workflowJsonString, // JSON 字符串，不是对象
      timestamp: Date.now()
    }

    try {
      window.parent.postMessage(message, '*')
    } catch (error) {
      console.error(
        '[WorkflowIntegration] ❌ Failed to send WORKFLOW_CHANGE:',
        error
      )
    }
  }

  /**
   * 初始化 postMessage 监听器
   */
  private initPostMessageListener() {
    window.addEventListener('message', (event) => {
      // 忽略来自当前窗口的消息
      if (event.source === window) {
        return
      }

      const messageType = event.data?.type

      switch (messageType) {
        case 'COMFYUI_LOAD_WORKFLOW':
          this.handleLoadWorkflow(
            event.data,
            event.source as Window,
            event.origin
          )
          break

        case 'COMFYUI_REQUEST_WORKFLOW_JSON':
          this.handleRequestWorkflowJson(
            event.data,
            event.source as Window,
            event.origin
          )
          break

        case 'COMFYUI_CLEAR_CANVAS':
          this.handleClearCanvas(event.source as Window, event.origin)
          break

        case 'COMFYUI_RESET_VIEW':
          this.handleResetView(event.source as Window, event.origin)
          break

        case 'COMFYUI_SET_LOCALE':
          this.handleSetLocale(event.data, event.source as Window, event.origin)
          break
      }
    })
  }

  /**
   * 处理工作流加载请求
   */
  private async handleLoadWorkflow(
    data: { workflowJson: ComfyWorkflowJSON | string; workflowId?: string },
    source: Window,
    origin: string
  ) {
    const { workflowJson, workflowId } = data

    // 如果 workflowJson 是字符串，先解析为对象
    const workflowData =
      typeof workflowJson === 'string'
        ? (JSON.parse(workflowJson) as ComfyWorkflowJSON)
        : workflowJson

    try {
      // 导入 app 避免循环依赖
      const { app } = await import('@/scripts/app')

      // 加载工作流
      await app.loadGraphData(workflowData, true, true, 'external_load', {
        showMissingNodesDialog: false,
        showMissingModelsDialog: false
      })

      // 保存当前 workflow ID
      this.currentWorkflowId = workflowId || null

      // 发送成功确认
      const ackMessage = {
        type: 'COMFYUI_LOAD_WORKFLOW_ACK',
        workflowId: workflowId || null,
        success: true,
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    } catch (error) {
      console.error('[WorkflowIntegration] ❌ Failed to load workflow:', error)

      // 发送失败确认
      const ackMessage = {
        type: 'COMFYUI_LOAD_WORKFLOW_ACK',
        workflowId: workflowId || null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    }
  }

  /**
   * 处理请求工作流 JSON
   */
  private async handleRequestWorkflowJson(
    messageData: { source?: string },
    source: Window,
    origin: string
  ) {
    const requestSource = messageData.source || 'manual'

    try {
      // 导入 app 避免循环依赖
      const { app } = await import('@/scripts/app')

      // 序列化当前工作流
      const workflowData = app.rootGraph.serialize() as ComfyWorkflowJSON
      const workflowJsonString = JSON.stringify(workflowData)

      // 发送响应
      const response = {
        type: 'COMFYUI_WORKFLOW_JSON_RESPONSE',
        workflowJson: workflowJsonString,
        source: requestSource,
        timestamp: Date.now()
      }

      source.postMessage(response, origin)
    } catch (error) {
      console.error(
        '[WorkflowIntegration] ❌ Failed to serialize workflow:',
        error
      )

      // 发送错误响应
      const errorResponse = {
        type: 'COMFYUI_WORKFLOW_JSON_RESPONSE',
        error: error instanceof Error ? error.message : 'Unknown error',
        source: requestSource,
        timestamp: Date.now()
      }

      source.postMessage(errorResponse, origin)
    }
  }

  /**
   * 处理清空画布请求
   */
  private async handleClearCanvas(source: Window, origin: string) {
    try {
      // 导入 app 和服务避免循环依赖
      const { app } = await import('@/scripts/app')
      const { useLitegraphService } =
        await import('@/services/litegraphService')

      // 清空画布
      const graph = app.rootGraph
      graph.clear()

      // 重置视图
      useLitegraphService().resetView()

      // 清除当前 workflow ID
      this.currentWorkflowId = null

      // 发送确认
      const ackMessage = {
        type: 'COMFYUI_CLEAR_CANVAS_ACK',
        success: true,
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    } catch (error) {
      console.error('[WorkflowIntegration] ❌ Failed to clear canvas:', error)

      // 发送错误响应
      const ackMessage = {
        type: 'COMFYUI_CLEAR_CANVAS_ACK',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    }
  }

  /**
   * 处理重置视图请求
   */
  private async handleResetView(source: Window, origin: string) {
    try {
      // 导入服务避免循环依赖
      const { useLitegraphService } =
        await import('@/services/litegraphService')

      // 重置视图（缩放和偏移）
      useLitegraphService().resetView()

      // 发送确认
      const ackMessage = {
        type: 'COMFYUI_RESET_VIEW_ACK',
        success: true,
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    } catch (error) {
      console.error('[WorkflowIntegration] ❌ Failed to reset view:', error)

      // 发送错误响应
      const ackMessage = {
        type: 'COMFYUI_RESET_VIEW_ACK',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    }
  }

  /**
   * 处理设置语言请求
   */
  private async handleSetLocale(
    data: { locale: string },
    source: Window,
    origin: string
  ) {
    const { locale } = data

    // 验证 locale 是否支持
    if (
      !locale ||
      typeof locale !== 'string' ||
      !SUPPORTED_LOCALES.includes(locale as any)
    ) {
      const errorMessage = `Unsupported locale: "${locale}". Supported locales: ${SUPPORTED_LOCALES.join(', ')}`
      console.error('[WorkflowIntegration] ❌', errorMessage)

      const ackMessage = {
        type: 'COMFYUI_SET_LOCALE_ACK',
        locale: locale || '',
        success: false,
        error: errorMessage,
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
      return
    }

    try {
      // 加载语言包
      await loadLocale(locale)

      // 设置语言
      const settingStore = useSettingStore()
      settingStore.set('Comfy.Locale', locale)

      // 发送成功确认
      const ackMessage = {
        type: 'COMFYUI_SET_LOCALE_ACK',
        locale: locale,
        success: true,
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    } catch (error) {
      console.error('[WorkflowIntegration] ❌ Failed to set locale:', error)

      // 发送失败确认
      const ackMessage = {
        type: 'COMFYUI_SET_LOCALE_ACK',
        locale: locale,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }

      source.postMessage(ackMessage, origin)
    }
  }

  /**
   * 手动触发工作流变化消息
   * 用于外部需要立即发送工作流状态的场景
   */
  triggerWorkflowChange(workflowData?: ComfyWorkflowJSON) {
    const workflowStore = useWorkflowStore()
    let data = workflowData

    // 如果没有提供 workflowData，则使用当前工作流的 activeState
    if (!data && workflowStore.activeWorkflow) {
      data = workflowStore.activeWorkflow.activeState
    }

    if (data) {
      // 清除防抖定时器并立即发送
      if (this.workflowChangeTimer) {
        clearTimeout(this.workflowChangeTimer)
        this.workflowChangeTimer = null
      }
      this.sendWorkflowChangeMessage(data)
    }
  }

  /**
   * 设置当前 workflow ID
   * 用于标识当前加载的工作流
   */
  setWorkflowId(workflowId: string) {
    this.currentWorkflowId = workflowId
  }

  /**
   * 获取当前 workflow ID
   */
  getWorkflowId(): string | null {
    return this.currentWorkflowId
  }

  /**
   * 清除当前 workflow ID
   */
  clearWorkflowId() {
    this.currentWorkflowId = null
  }
}

// 单例模式
export const workflowIntegrationService = new WorkflowIntegrationService()

/**
 * 初始化工作流集成服务
 * 应该在应用启动时调用
 */
export const initWorkflowIntegration = () => {
  workflowIntegrationService.init()
}

/**
 * 导出供外部使用的辅助函数
 */
export const setWorkflowId = (workflowId: string) => {
  workflowIntegrationService.setWorkflowId(workflowId)
}

export const getWorkflowId = () => {
  return workflowIntegrationService.getWorkflowId()
}

export const clearWorkflowId = () => {
  workflowIntegrationService.clearWorkflowId()
}

export const triggerWorkflowChange = (workflowData?: ComfyWorkflowJSON) => {
  workflowIntegrationService.triggerWorkflowChange(workflowData)
}

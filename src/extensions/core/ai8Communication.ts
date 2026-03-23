import { i18n, loadLocale } from '@/i18n'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'
import { useSettingStore } from '@/platform/settings/settingStore'
import { useLitegraphService } from '@/services/litegraphService'
import { api } from '@/scripts/api'
import { app } from '@/scripts/app'

type ParentMessageData = {
  type?: string
  token?: string
  workflowId?: number | string
  workflowJson?: string | ComfyWorkflowJSON
  source?: string
  locale?: string
}

const postToParent = (message: Record<string, unknown>) => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*')
  }
}

const serializeWorkflowPayload = async () => {
  const workflow = app.rootGraph.serialize() as unknown as ComfyWorkflowJSON
  const workflowJson = JSON.stringify(workflow)
  const workflowApi = await app.graphToPrompt(app.rootGraph)
  const workflowApiJson = JSON.stringify(workflowApi)
  return { workflowJson, workflowApiJson }
}

app.registerExtension({
  name: 'Comfy.AI8Communication',
  setup() {
    postToParent({
      type: 'COMFYUI_AUTH_READY',
      timestamp: Date.now()
    })

    const onGraphChanged = (event: Event) => {
      const customEvent = event as CustomEvent<ComfyWorkflowJSON>
      const workflow = customEvent.detail ?? app.rootGraph.serialize()
      postToParent({
        type: 'COMFYUI_WORKFLOW_CHANGE',
        workflowJson: JSON.stringify(workflow),
        timestamp: Date.now()
      })
    }

    const onParentMessage = async (event: MessageEvent<ParentMessageData>) => {
      const data = event.data
      if (!data?.type) return

      if (data.type === 'COMFYUI_AUTH') {
        const token = data.token ?? ''
        if (token) {
          localStorage.setItem('authToken', token)
          sessionStorage.setItem('authToken', token)
          api.authToken = token
        }

        postToParent({
          type: 'COMFYUI_AUTH_ACK',
          success: true,
          timestamp: Date.now()
        })
        return
      }

      if (data.type === 'COMFYUI_LOAD_WORKFLOW') {
        try {
          const workflowPayload =
            typeof data.workflowJson === 'string'
              ? (JSON.parse(data.workflowJson) as ComfyWorkflowJSON)
              : data.workflowJson

          await app.loadGraphData(workflowPayload)
          postToParent({
            type: 'COMFYUI_LOAD_WORKFLOW_ACK',
            workflowId: data.workflowId,
            source: data.source ?? 'unknown',
            success: true,
            timestamp: Date.now()
          })
        } catch (error: unknown) {
          postToParent({
            type: 'COMFYUI_LOAD_WORKFLOW_ACK',
            workflowId: data.workflowId,
            source: data.source ?? 'unknown',
            success: false,
            error:
              error instanceof Error ? error.message : 'load workflow failed',
            timestamp: Date.now()
          })
        }
        return
      }

      if (data.type === 'COMFYUI_REQUEST_WORKFLOW_JSON') {
        try {
          const { workflowJson, workflowApiJson } =
            await serializeWorkflowPayload()
          postToParent({
            type: 'COMFYUI_WORKFLOW_JSON_RESPONSE',
            workflowJson,
            workflowApiJson,
            source: data.source ?? 'manual',
            timestamp: Date.now()
          })
        } catch (error: unknown) {
          postToParent({
            type: 'COMFYUI_WORKFLOW_JSON_RESPONSE',
            workflowJson: '',
            workflowApiJson: '',
            source: data.source ?? 'manual',
            error:
              error instanceof Error
                ? error.message
                : 'serialize workflow failed',
            timestamp: Date.now()
          })
        }
        return
      }

      if (data.type === 'COMFYUI_CLEAR_CANVAS') {
        app.clean()
        return
      }

      if (data.type === 'COMFYUI_RESET_VIEW') {
        useLitegraphService().resetView()
        return
      }

      if (data.type === 'COMFYUI_SET_LOCALE') {
        const locale = (data.locale ?? '').trim()
        if (!locale) {
          postToParent({
            type: 'COMFYUI_SET_LOCALE_ACK',
            locale: data.locale ?? '',
            success: false,
            error: 'locale is required',
            timestamp: Date.now()
          })
          return
        }

        try {
          await loadLocale(locale)
          i18n.global.locale.value = locale as typeof i18n.global.locale.value
          await useSettingStore().set('Comfy.Locale', locale as never)
          postToParent({
            type: 'COMFYUI_SET_LOCALE_ACK',
            locale,
            success: true,
            timestamp: Date.now()
          })
        } catch (error: unknown) {
          postToParent({
            type: 'COMFYUI_SET_LOCALE_ACK',
            locale,
            success: false,
            error: error instanceof Error ? error.message : 'set locale failed',
            timestamp: Date.now()
          })
        }
      }
    }

    api.addEventListener('graphChanged', onGraphChanged)
    window.addEventListener('message', (event) => {
      void onParentMessage(event as MessageEvent<ParentMessageData>)
    })
  }
})

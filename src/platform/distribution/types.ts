import { isElectron } from '@/utils/envUtil'

/**
 * Distribution types and compile-time constants for managing
 * multi-distribution builds (Desktop, Localhost, Cloud)
 */

type Distribution = 'desktop' | 'localhost' | 'cloud'

declare global {
  const __DISTRIBUTION__: Distribution
  const __EDITOR_ONLY_MODE__: boolean
}

/** Current distribution - replaced at compile time */
const DISTRIBUTION: Distribution = __DISTRIBUTION__

/** Distribution type checks */
export const isDesktop = DISTRIBUTION === 'desktop' || isElectron() // TODO: replace with build var
export const isCloud = DISTRIBUTION === 'cloud'
// export const isLocalhost = DISTRIBUTION === 'localhost' || (!isDesktop && !isCloud)

/** Editor-only mode - when true, execution features are disabled */
export const isEditorOnly = __EDITOR_ONLY_MODE__ || false

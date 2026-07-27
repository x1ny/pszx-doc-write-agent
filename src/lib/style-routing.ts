const styleRewriteIntentPattern =
  /(?:风格改写|风格重写|按(?:照|着)?(?:我的|已记住的|记忆中的|工作记忆中的|已保存的|常用的)?(?:写作)?风格(?:改写|重写)|用(?:记忆中的|已保存的|我的(?:常用)?)(?:写作)?风格(?:改写|重写))/i

const leaderTargetPattern =
  /(?:局长|书记|部长|主任|领导|作者|作家|先生|女士|李局长)/

const memoryReferencePattern =
  /(?:working\s*memory|工作记忆|记忆中|已记住|已保存|保存的|我的(?:常用)?风格)/i

const leaderStyleActionPattern =
  /(?:学习|检索|查找|搜索|分析|研究|模仿|仿写|改写|重写|改成|改为|按照|按着|使用|采用)/

const styleRewriteTaskPattern =
  /(?:风格改写|风格重写|改写.{0,12}风格|重写.{0,12}风格|按.{0,24}风格(?:改写|重写)|(?:学习|检索|查找|搜索|分析|研究|模仿|仿写|改成|改为|按照|按着|改用|使用|采用).{0,24}风格(?:改写|重写)?)/i

const explicitMemoryPersistencePattern =
  /(?:请记住|记住这个|以后都这样|长期使用|保存(?:到|为)?(?:工作记忆|记忆|偏好)?|写入(?:工作记忆|记忆|长期偏好)|作为长期偏好)/i

/**
 * 判断本轮是否应直接使用 Working Memory 中已保存的写作风格。
 *
 * 只有用户明确提出人物风格学习/检索/分析，且没有说明要使用已保存记忆时，
 * 才允许走人物历史材料分析工具。
 */
export function shouldUseWorkingMemoryStyleRewrite(text: string) {
  const normalizedText = text.replace(/<document_selection>[\s\S]*?<\/document_selection>/gi, "").trim()

  if (!styleRewriteIntentPattern.test(normalizedText)) {
    return false
  }

  const explicitlyRequestsLeaderStyle =
    leaderTargetPattern.test(normalizedText) &&
    leaderStyleActionPattern.test(normalizedText) &&
    !memoryReferencePattern.test(normalizedText)

  return !explicitlyRequestsLeaderStyle
}

/** 风格改写默认是一次性任务，只读取记忆，不允许写回记忆。 */
export function shouldKeepWorkingMemoryReadOnly(text: string) {
  const normalizedText = text.replace(/<document_selection>[\s\S]*?<\/document_selection>/gi, "").trim()

  return (
    styleRewriteTaskPattern.test(normalizedText) &&
    !explicitMemoryPersistencePattern.test(normalizedText)
  )
}

export const workingMemoryStyleActiveTools = [
  "getCurrentTime",
  "proposeArticleOutline",
  "simulateDocumentDataRefresh",
  "verifyKnowledgeBase",
  "writeMarkdownToPlate",
  "getDocumentSnapshot",
  "applyLocalEdit",
] as const

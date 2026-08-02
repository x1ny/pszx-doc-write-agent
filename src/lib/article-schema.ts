import { z } from "zod"

export const outlineSchema = z.object({
  title: z
    .string()
    .describe("最终公文正文的唯一主标题，对应唯一 h1；只填写标题文本，不包含 # 标记"),
  summary: z
    .string()
    .describe("仅供全文生成使用的整体写作说明，不作为摘要、标题或独立正文段落输出"),
  sections: z
    .array(
      z.object({
        id: z
          .string()
          .describe("章节稳定且唯一的标识，依次使用 section-1、section-2 等值"),
        title: z
          .string()
          .describe("一级章节标题，按顺序一一对应 h2；以“一、”“二、”等规范序号开头，不包含 ## 标记"),
        purpose: z
          .string()
          .describe("本章节的写作目的，仅指导普通正文段落生成，不作为标题或独立段落原样输出"),
        keyPoints: z
          .array(
            z
              .string()
              .describe("单条正文要点，直接从实际内容开始，不添加 G、gdp、项目符号、序号或其他前缀")
          )
          .describe("本章节正文必须覆盖的具体要点，仅指导普通段落生成，不输出为 Markdown 列表"),
      })
    )
    .min(1)
    .describe("扁平的一级章节列表，每个章节最终对应一个 h2，不允许嵌套子章节"),
})

export type ArticleOutline = z.infer<typeof outlineSchema>

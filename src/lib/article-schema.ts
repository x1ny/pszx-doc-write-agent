import { z } from "zod"

export const outlineSchema = z.object({
  title: z.string().describe("文章标题"),
  summary: z.string().describe("文章摘要"),
  sections: z
    .array(
      z.object({
        id: z.string().describe("章节唯一标识"),
        title: z.string().describe("章节标题"),
        purpose: z.string().describe("本章节的写作目的"),
        keyPoints: z.array(z.string()).describe("本章节需要覆盖的要点"),
      })
    )
    .min(1)
    .describe("文章章节列表"),
})

export type ArticleOutline = z.infer<typeof outlineSchema>



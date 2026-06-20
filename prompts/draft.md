---
description: Turn research findings into a polished paper-style draft with equations, sections, and explicit claims.
args: <topic>
section: Research Workflows
topLevelCli: true
---
## Tool Discipline (Read First)

Tool names are literal. Use only tools visible in the current tool set.

- Search with `web` using `action: "search"` and `query`; do not call `web_search`, `search_web`, `google_search`, `google:search`, `search_google`, or `WebSearch`.
- Navigate or fetch pages with `web` using `action: "goto"` and an absolute http(s) `url`; do not call `fetch_content`, bare `fetch`, `WebFetch`, or `read_url_content`.
- Click links with `web` using `action: "click"` and a kdriver `ref` (for example `e142`). Paginate with `action: "search_next"`. Close the session with `action: "close"`.
- Full page content is written to artifact paths returned by `web`; read those files with `read` instead of expecting inline dumps.
- Use visible Feynman alpha tools such as `alpha_search` when present. For shell access, call `feynman alpha ...`; do not call the user's bare global `alpha` binary.
- To ask the user a question, write plain chat text and wait for the next user message. Do not call `ask_user_question`, `ask_user`, `ask_followup_question`, or `user_choice`.
- Do not use `Task` as an agent dispatcher. Use only the visible `subagent` tool when it exists.
- If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call. Map to a canonical visible tool and valid arguments, or record the capability as blocked.

Write a paper-style draft for: $@

Derive a short slug from the topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

Requirements:
- Before writing, outline the draft structure: proposed title, sections, key claims to make, source material to draw from, and a verification log for the critical claims, figures, and calculations. Write the outline to `outputs/.plans/<slug>.md`. Briefly summarize the outline to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested outline review.
- Use the `writer` subagent when the draft should be produced from already-collected notes, then use the `verifier` subagent to add inline citations and verify sources.
- Include at minimum: title, abstract, problem statement, related work, method or synthesis, evidence or experiments, limitations, conclusion.
- Use clean Markdown with LaTeX where equations materially help.
- Follow the system prompt's provenance rules for all results, figures, charts, images, tables, benchmarks, and quantitative comparisons. If evidence is missing, leave a placeholder or proposed experimental plan instead of claiming an outcome.
- Generate charts only when a chart tool is visible and the underlying source-backed quantitative data, benchmarks, or comparisons support the visual; otherwise write a chart specification or table. Use Mermaid for architectures and pipelines only when the structure is supported by sources. Every figure, chart spec, or table needs provenance.
- Before delivery, sweep the draft for any claim that sounds stronger than its support. Mark tentative results as tentative and remove unsupported numerics instead of letting the verifier discover them later.
- Save exactly one draft to `papers/<slug>.md`.
- End with a `Sources` appendix with direct URLs for all primary references.

---
description: Compare multiple sources on a topic and produce a source-grounded matrix of agreements, disagreements, and confidence.
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

Compare sources for: $@

Derive a short slug from the comparison topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

Requirements:
- Before starting, outline the comparison plan: which sources to compare, which dimensions to evaluate, expected output structure. Write the plan to `outputs/.plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
- Use the `researcher` subagent to gather source material when the comparison set is broad, and the `verifier` subagent to verify sources and add inline citations to the final matrix.
- Build a comparison matrix covering: source, key claim, evidence type, caveats, confidence.
- Generate charts only when a chart tool is visible and the comparison involves quantitative metrics; otherwise include a source-backed table or chart specification. Use Mermaid for method or architecture comparisons when the structure is source-supported.
- Distinguish agreement, disagreement, and uncertainty clearly.
- Save exactly one comparison to `outputs/<slug>-comparison.md`.
- End with a `Sources` section containing direct URLs for every source used.

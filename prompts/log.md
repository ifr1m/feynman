---
description: Write a durable session log with completed work, findings, open questions, and next steps.
section: Project & Session
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

Write a session log for the current research work.

Requirements:
- Summarize what was done in this session.
- Capture the strongest findings or decisions.
- List open questions, unresolved risks, and concrete next steps.
- Reference any important artifacts written to `notes/`, `outputs/`, `experiments/`, or `papers/`.
- If any external claims matter, include direct source URLs.
- Save the log to `notes/` as markdown with a date-oriented filename.

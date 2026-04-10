# Observe v2 — Competitive Analysis & Extension Roadmap

> Date: 2026-04-10
> Purpose: Map competitor features against our implementation, identify gaps, design extension roadmap

---

## 1. Competitor Research

### 1.1 Langfuse (MIT, self-host, 10k+ stars)

| Item | URL |
|------|-----|
| GitHub | https://github.com/langfuse/langfuse |
| Docs | https://langfuse.com/docs |
| Tracing | https://langfuse.com/docs/tracing |
| Analytics | https://langfuse.com/docs/analytics/overview |
| Evaluation | https://langfuse.com/docs/scores/overview |
| Prompt Mgmt | https://langfuse.com/docs/prompts/get-started |
| Self-host | https://langfuse.com/docs/deployment/self-host |

**Key features**: Nested span traces, model cost/latency dashboard, LLM-as-judge evaluation, prompt version management, session grouping, dataset-based experiment comparison

**Gap vs us**: Evaluation scoring system, prompt versioning, dataset/experiment comparison

---

### 1.2 LangSmith (LangChain, closed-source)

| Item | URL |
|------|-----|
| Product | https://www.langchain.com/langsmith/observability |
| Docs | https://docs.langchain.com/oss/python/langgraph/observability |
| SDK | https://github.com/langchain-ai/langsmith-sdk |
| Deep Agents Blog | https://blog.langchain.com/debugging-deep-agents-with-langsmith/ |
| Tracing Deep Dive | https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747 |
| E2E Agent Tracing | https://ravjot03.medium.com/langsmith-for-agent-observability-tracing-langgraph-tool-calling-end-to-end-2a97d0024dfb |

**Key features**: Run tree (LLM/Tool/Chain nodes), input/output/time/token inline inspection, "Polly" AI analysis, prompt side-by-side comparison

**Gap vs us**: Run tree drill-down (our Flow is swim lane based), AI-based trace analysis, prompt comparison

---

### 1.3 AgentOps (MIT, SDK-based, 5.4k stars)

| Item | URL |
|------|-----|
| GitHub | https://github.com/AgentOps-AI/agentops |
| Docs | https://docs.agentops.ai/ |
| Paper | https://arxiv.org/html/2411.05285v2 |
| Homepage | https://www.agentops.ai/ |
| Learning Path | https://www.analyticsvidhya.com/blog/2025/12/agentops-learning-path/ |
| Comparison | https://aimultiple.com/agentic-monitoring |

**Key features**: 2-line SDK integration, session replay (time-travel debugging), LLM cost tracking, multi-agent monitoring, benchmarking. SDK-based (not proxy) — runs in own infra, ~12% overhead

**Gap vs us**: Time-travel replay (timeline slider + state reconstruction), benchmarking

---

### 1.4 Braintrust (Eval-centric)

| Item | URL |
|------|-----|
| Homepage | https://www.braintrust.dev/ |
| GitHub | https://github.com/braintrustdata (braintrust-sdk, autoevals, braintrust-proxy) |
| Autoevals | https://github.com/braintrustdata/autoevals |
| Proxy Docs | https://www.braintrust.dev/docs/guides/proxy |
| Pricing | https://www.braintrust.dev/pricing |
| Comparison | https://www.braintrust.dev/articles/best-ai-observability-platforms-2025 |

**Key features**: Trace inspection, LLM/code/human eval scoring, prompt side-by-side experiments, cost/latency/quality realtime dashboard, AI gateway (OpenAI-compatible multi-provider + caching), Loop agent (auto eval), GitHub Action PR eval

**Gap vs us**: Eval scoring system, prompt experiment comparison, CI/CD eval integration

---

### 1.5 Portkey (AI Gateway + Observability)

| Item | URL |
|------|-----|
| GitHub | https://github.com/Portkey-AI/gateway |
| Observability | https://portkey.ai/features/observability |
| Gateway Docs | https://portkey.ai/docs/product/ai-gateway |
| Architecture Blog | https://portkey.ai/blog/the-most-reliable-ai-gateway-for-production-systems/ |
| MCP Gateway | https://portkey.ai/features/mcp |

**Key features**: <1ms AI gateway (200+ LLMs, 50+ guardrails), 40+ metrics per request, tool call param/response/latency logging, dynamic model switching, load balancing, failover. SOC2/HIPAA/GDPR

**Gap vs us**: Gateway/proxy functionality, guardrail integration, multi-provider routing

---

### 1.6 AgentGraph / LangGraph

| Item | URL |
|------|-----|
| AgentGraph | https://github.com/rishabhpoddar/agentgraph |
| LangGraph | https://github.com/langchain-ai/langgraph |
| LangGraph Docs | https://docs.langchain.com/oss/python/langgraph/overview |

**AgentGraph**: Interactive graph visualization of LLM interactions and tool calls. npm integration.
**LangGraph**: Define/execute agents as stateful graphs. Human-in-the-loop, long-term memory.

**Gap vs us**: Interactive graph visualization (zoom/pan/drag), real-time graph updates

---

### 1.7 AgentWatch (CyberArk, security-focused)

| Item | URL |
|------|-----|
| GitHub | https://github.com/cyberark/agentwatch |

**Key features**: Agent interaction monitoring/optimization, security-focused, cross-platform. Similar direction to our vulnerability detection.

---

### 1.8 Landscape Overview

| Source | URL |
|--------|-----|
| AI Observability Tools 2026 | https://arize.com/blog/best-ai-observability-tools-for-autonomous-agents-in-2026/ |
| 120+ Agentic AI Tools | https://www.stackone.com/blog/ai-agent-tools-landscape-2026/ |
| AgentOps Comparison | https://aimultiple.com/agentic-monitoring |

---

## 2. Current State of Observe

| Tab | Features | Maturity |
|-----|----------|----------|
| Events | Real-time event stream, filtering, search, expand/collapse | ★★★★ |
| Flow | Swim lane agent visualization, subagent delegation, cost badges | ★★★★ |
| Metrics | KPI cards, token/model breakdown, waste analysis, retry detection, vulnerability patterns | ★★★ |
| OTel Ingest | OTLP /v1/logs, /v1/metrics, /v1/traces | ★★★★ |
| Cross-tab | Metrics → Flow timestamp navigation | ★★★ |

### Our Unique Strengths (competitors don't have)

1. **Claude Code native**: Parse OTel event structure exactly (prompt_id, tool_decision, permission events)
2. **Swim lane Flow**: Per-agent lanes for parallel execution visualization (LangSmith uses simple tree)
3. **Mechanical vulnerability detection**: permission bypass, cost spike, loop, hook evasion, token surge
4. **Harness integration**: View hook/skill config from dashboard
5. **Zero-config OTLP**: 4 env vars to start collecting
6. **Dual channel**: Hook events (structural) + OTel (numeric) → richer than either alone

---

## 3. Extension Roadmap

### Phase 1: High ROI, Existing Data (Difficulty: Medium)

#### 3.1 Trace Tree View (inspired by LangSmith)
> Add "Tree" toggle to Flow tab — collapsible run hierarchy

- Group by prompt_id: LLM call → tool call → result as nested tree
- Click any node to inspect input/output/tokens/cost/latency inline
- Toggle between existing swim lane and tree view

**Why**: LangSmith's #1 feature. We already have all the data, just need a different rendering.

#### 3.2 Session Replay (inspired by AgentOps)
> Timeline slider to replay agent execution chronologically

- Add play/pause/speed controls to ActivityTimeline
- Auto-scroll & highlight current event
- Sync with Flow tab — highlight active node during replay

**Why**: AgentOps's key differentiator. We already have the timeline + events.

#### 3.3 Cost Anomaly Alerts (inspired by Portkey)
> Real-time cost anomaly detection via WebSocket push

- Extend existing vulnerability detection's cost_spike to real-time WebSocket push
- Toast notification in dashboard when session cost exceeds threshold
- Optional: Slack/Discord webhook

**Why**: Low difficulty (existing WS infra), high value for production monitoring.

---

### Phase 2: Differentiation (Difficulty: Medium-High)

#### 3.4 Evaluation Scoring (inspired by Langfuse/Braintrust)
> Attach scores to sessions/turns

- **Code-based scorer**: Extend vulnerability detection into a scoring system
- **Human scorer**: UI card to manually score sessions (1-5) with comments
- **LLM-as-judge**: Optional LLM call to evaluate session quality (user opt-in)
- DB: `session_scores` table (session_id, scorer_type, score, comment, timestamp)

**Why**: Every major competitor has eval. We can start with code-based (mechanical) and add LLM later.

#### 3.5 Cross-Session Analytics (inspired by Braintrust)
> Compare multiple sessions in a dashboard

- Project page: cost/token/success rate comparison table across sessions
- Session eval score trends over time
- Model/tool usage patterns time series

**Why**: Currently we only look at one session at a time. Project-level insights are essential.

#### 3.6 Interactive Graph View (inspired by AgentGraph)
> Force-directed graph as alternative to swim lanes

- react-flow or d3-force based interactive graph
- Nodes = events, edges = causal relationships (spawn, delegation, tool call)
- Zoom/pan/drag support, node size = cost or tokens

**Why**: Visual impact for demos, better for understanding complex multi-agent interactions.

---

### Phase 3: Advanced Features (Difficulty: High)

#### 3.7 Prompt Versioning (inspired by Langfuse)
> Track system prompt changes and compare performance

- Extract prompt hash from OTel system_prompt events
- Compare performance metrics (cost, success rate, tokens) by prompt hash

#### 3.8 LLM-based Agent Analysis (AgentSeer territory)
> Use LLM to analyze/summarize sessions

- Generate "what the agent did this session" summary
- Natural language explanation of anomalous patterns
- Cost: requires API call → user opt-in only

#### 3.9 CI/CD Eval Integration (inspired by Braintrust)
> GitHub Action to post eval results to PRs

- Run test harness → record session in Observe → compute eval score → PR comment

---

## 4. Implementation Priority Matrix

| # | Feature | Difficulty | Impact | Data Ready? | Recommended |
|---|---------|-----------|--------|-------------|-------------|
| 1 | Trace Tree View | Medium | High | Yes | **Phase 1** |
| 2 | Cost Anomaly Alerts | Low | Medium | Yes | **Phase 1** |
| 3 | Session Replay | Medium | High | Yes | **Phase 1** |
| 4 | Cross-Session Analytics | Medium | High | Partial | **Phase 2** |
| 5 | Eval Scoring | Medium | High | No | **Phase 2** |
| 6 | Interactive Graph | High | Medium | Yes | **Phase 2** |
| 7 | Prompt Versioning | Medium | Medium | No | Phase 3 |
| 8 | LLM Analysis | High | Medium | No | Phase 3 |
| 9 | CI/CD Eval | High | High | No | Phase 3 |

---

## 5. Technical Stack Considerations

| Feature | Tech Needed | Reuse |
|---------|-------------|-------|
| Trace Tree View | React tree component | Existing OTel data + flow-builder.ts |
| Session Replay | Timer + scroll sync | Existing ActivityTimeline |
| Cost Alerts | WebSocket push | Existing WS + MetricsAggregator |
| Eval Scoring | DB table + API + UI | New table, existing card patterns |
| Cross-Session | SQL aggregation + UI | session_summaries table exists |
| Interactive Graph | react-flow / d3-force | New dependency |
| Prompt Versioning | Hash logic + new table | New |
| LLM Analysis | External API + cost mgmt | New |
| CI/CD Eval | GitHub Action + API client | New |

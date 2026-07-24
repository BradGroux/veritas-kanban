# Best Practices & Anti-Patterns

Codify what works (and what burns us) when running Veritas Kanban with humans + AI agents.

---

## Do This

1. **Track time through the correct lifecycle owner**
   - Humans and external agents start timers with `vk begin` when they pick up a task.
   - Managed harness runs let VK and the adapter own timing automatically.
   - If you forgot, add a manual entry with reason. Time data fuels estimation and billing.

2. **Use subtasks as living checklists**
   - Break work into 3–8 subtasks.
   - Mark them complete as you progress; unfinished subtasks make blockers obvious.

3. **Write acceptance criteria inside the task description**
   - Bullet list or checklist. Agents need crisp definitions of done.

4. **Post completion summaries + links**
   - Final comment should include what changed, where to find artifacts, and next steps.

5. **Keep tasks atomic**
   - One deliverable per task. If work spans >3 days or mixes unrelated goals, split it.

6. **Update SOP files after every lesson**
   - Mistake → update AGENTS.md/CLAUDE.md + Lessons Learned field.

7. **Respect configured review requirements**
   - Run independent or cross-model review only when the task, governance
     policy, issue owner, or release owner requires it.

8. **Mirror important artifacts to Brain/knowledge base**
   - Use `scripts/brain-write.sh` or equivalent so humans can find deliverables later.

9. **Use Agent Status + comments for visibility**
   - Set `vk agent working` when you start; leave concise updates in comments instead of DM spam.

10. **Archive aggressively**
    - Done column should stay lean. Use multi-select + archive (bug tracked separately) at sprint end.

---

## Don’t Do This

1. **Tasks without acceptance criteria**
   - Leads to rework and ambiguous reviews.

2. **Skipping time tracking**
   - “It was quick” is not data. Even 5-minute fixes get tracked.

3. **Giant grab-bag tasks**
   - “Implement feature + write docs + shoot video” belongs in separate tasks.

4. **Auto-piloting agents without supervision**
   - Read summaries, inspect diffs, and enforce the review policy selected for
     the task.

5. **Letting prompts drift**
   - Keep prompt registry updated or agents will regress.

6. **Leaving example tasks in production boards**
   - Clear the seed tasks before real work to avoid confusion.

7. **Treating planning as a board status**
   - Planning is a checklist/subtask, not `TaskStatus`. Valid statuses: todo, in-progress, blocked, done.

8. **Storing secrets in tasks**
   - Use vault/secret manager references, never raw credentials.

9. **Ignoring Lessons Learned**
   - If you uncover a process flaw and don’t log it, you’ll repeat it next sprint.

10. **Copy/pasting unvetted external code**
    - Run security review (see RF-002) and cite sources.

---

## Advanced Features — Best Practices

11. **Use task dependencies to enforce ordering**
    - Set `depends_on` / `blocks` relationships so agents don't start work before prerequisites are complete.
    - The API's cycle detection prevents circular chains — trust it and model dependencies accurately.

12. **Leverage crash-recovery checkpointing for long tasks**
    - Call `POST /api/tasks/:id/checkpoint` periodically during multi-step agent work.
    - Secrets are auto-sanitized — don't worry about leaking credentials in checkpoint state.
    - Clear checkpoints after task completion to avoid stale data (`DELETE /api/tasks/:id/checkpoint`).

13. **Capture observations for institutional memory**
    - Log decisions, blockers, and insights as observations (`POST /api/observations`).
    - Use importance scoring (1–10) so future agents can filter by significance.
    - Search across all tasks with `GET /api/observations/search?query=...` to avoid repeating past mistakes.

14. **Use the agent filter for workload visibility**
    - Query `GET /api/tasks?agent=name` to see what each agent is working on before assigning new work.

15. **Use workflows for repeatable multi-agent pipelines**
    - If you're doing the same plan→implement→review cycle repeatedly, encode it as a YAML workflow.
    - Workflows provide retry policies, gate approvals, and real-time observability that ad-hoc scripts don't.

---

## v4.0 Governance — Best Practices

16. **Define policies before deploying agents**
    - Set up tool/action policies (`/api/policies`) with guard rules before agents start work.
    - Use `deny-first` precedence for production; `allow-first` for development.

17. **Monitor behavioral drift proactively**
    - Configure baselines and alert thresholds via `/api/drift` for key agent metrics.
    - Review drift status regularly — `warning` → `alert` escalation means an agent is deviating.

18. **Log decisions with assumptions**
    - Every significant agent decision should include supporting evidence and explicit assumptions via `/api/decisions`.
    - Record outcomes after the fact to build institutional knowledge about what works.

19. **Score agent outputs consistently**
    - Create scoring profiles with weighted criteria for repeatable evaluation.
    - Use `geometricMean` composite scoring to penalize low scores in any single dimension.

20. **Close the feedback loop**
    - Collect user feedback on agent outputs with sentiment and category tags via `/api/feedback`.
    - Review feedback analytics weekly to catch quality regressions before they compound.

Stick to these rules and the board stays trustworthy even with dozens of agents in parallel.

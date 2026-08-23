# Prompt Registry

Copy/paste prompt templates for AI agents working with Veritas Kanban.

## Usage

1. Copy the relevant prompt from this registry
2. Customize placeholders (`<task-id>`, `<project>`, etc.) for your context
3. Reference in task descriptions: `See prompt: prompt-registry/<name>.md`

## Available Prompts

| Prompt                                           | Use Case                                |
| ------------------------------------------------ | --------------------------------------- |
| [sprint-planning.md](sprint-planning.md)         | Break down epics into sprints and tasks |
| [worker-handoff.md](worker-handoff.md)           | PM → Worker task assignment             |
| [cross-model-review.md](cross-model-review.md)   | Optional independent code review        |
| [feature-development.md](feature-development.md) | End-to-end feature implementation       |
| [bug-triage.md](bug-triage.md)                   | Issue investigation and fix             |
| [research-report.md](research-report.md)         | Deep research deliverable               |
| [task-completion.md](task-completion.md)         | Standard task wrap-up                   |
| [blocked-escalation.md](blocked-escalation.md)   | When work is blocked                    |
| [pm-orchestration.md](pm-orchestration.md)       | PM agent managing workers               |
| [standup-summary.md](standup-summary.md)         | Daily status report                     |

## Customization

Teams should fork this registry and customize prompts for their workflow:

```bash
# Copy to your project
cp -r prompt-registry/ my-project/prompts/

# Edit to match your conventions
vim my-project/prompts/sprint-planning.md
```

## Credit

Prompt registry pattern inspired by [BoardKit Orchestrator](https://github.com/BoardKit/orchestrator) by Monika Voutov.

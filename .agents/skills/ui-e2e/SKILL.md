---
name: ui-e2e
description: Prove web UI work with design mocks, a states gallery, browser tests against a mock backend, settled-frame screenshots, and read-only live journeys. Use for any change to how a console looks or behaves, a UI redesign, a UX audit, or a visual Pull Request. Uses the shared Sannrox agent-kit installation.
---

# UI E2E

Use the canonical [ui-e2e skill](https://github.com/Sannrox/agent-kit/tree/main/skills/ui-e2e).
Read the complete installed `~/.agents/agent-kit/skills/ui-e2e/SKILL.md` and the
references it requires before starting. If installed at another operator-selected location
(`$AGENT_KIT_HOME`), use that installation. This repository entrypoint contains no
workflow implementation.

If the skill is missing, run `bash scripts/validate-workflow-skills.sh` from this repository
(it clones or updates the kit), or clone it directly:
`git clone https://github.com/Sannrox/agent-kit ~/.agents/agent-kit`. Run `git pull` in that
checkout to get the latest version; consumers always use `main`.

Run the shared skill's scripts from the repository being changed, preserving its working
directory. Follow this repository's `AGENTS.md` (including `## Agent skill profile`) in addition to the
canonical skill.

Keep shared fixes and instructions upstream in `Sannrox/agent-kit`. When the stub template
changes upstream, run `bash scripts/validate-workflow-skills.sh --render`. Do not add
repository-local helpers or copies.

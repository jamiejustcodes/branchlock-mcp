# Agent Workspace Coordination (BranchLock)

This repository uses **BranchLock MCP** to prevent concurrent AI agents from creating merge collisions and overwriting each other's work.

## Protocol for AI Agents:
1. **Lock Before Edit**: Always call the `claim_files` MCP tool on files you intend to modify before applying changes.
2. **Respect Conflicts**: If a claim is rejected due to an active lock held by another agent, halt modifications to those files and notify the developer.
3. **Broadcast Architecture Decisions**: Call `broadcast_context` when making cross-cutting decisions (e.g. auth changes, schema migrations).
4. **Release On Task Completion**: Call `release_files` with `completed: true` when your edits are finished.

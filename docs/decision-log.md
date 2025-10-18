# Decision Log

## 2025-10-18: Development Environment Setup

**Decision:** The project MUST reside outside of any cloud-synced folders (OneDrive, Dropbox, etc.).

**Context:** After extensive debugging of Metro errors (`Failed to get SHA-1`), it was determined that the root cause was interference between OneDrive's file sync system and the Metro watcher.

**Consequence:** Moving the project to a simple path like `C:\dev\` resolved all Metro resolution issues. This is a non-negotiable rule for developing this project on Windows.

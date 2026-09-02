# Markdown is the domain source of truth

Personal OS stores every durable domain fact in the user-owned Personal Data Directory as readable Markdown rather than making SQLite or DSH-managed storage authoritative. This preserves direct access, editing, portability, and recovery outside DeepSeek Harness; in-memory indexes and any future SQLite search index are disposable projections that must be completely rebuildable from the directory.

.PHONY: help dev build preview agent agent-dev agent-token install clean db-reset db-path

# ─── Config ──────────────────────────────────────────────────────────────
AGENT_ROOT  ?= $(CURDIR)
AGENT_PORT  ?= 7421
AGENT_HOST  ?= 0.0.0.0
AGENT_TOKEN ?=

# Agent SQLite database (sessions, tasks, messages, file_snapshots, etc.)
DB_DIR  ?= $(HOME)/.ide-ux-agentik
DB_FILE ?= $(DB_DIR)/data.sqlite

# ─── Help ────────────────────────────────────────────────────────────────
help:
	@echo "ide-ux-agentik — available targets"
	@echo ""
	@echo "  make install       install frontend + agent deps"
	@echo "  make dev           run webapp dev server (vite)"
	@echo "  make build         build webapp for production"
	@echo "  make preview       preview the production build"
	@echo ""
	@echo "  make agent         run the remote agent"
	@echo "                       AGENT_ROOT=$(AGENT_ROOT)"
	@echo "                       AGENT_PORT=$(AGENT_PORT)"
	@echo "                       AGENT_HOST=$(AGENT_HOST)"
	@echo "                       AGENT_TOKEN=(required — pass or set)"
	@echo "  make agent-token   generate a random token"
	@echo "  make agent-dev     run agent rooted on ./ with a random token"
	@echo ""
	@echo "  make clean         remove build artifacts"
	@echo ""
	@echo "  make db-path       print the agent database path"
	@echo "  make db-reset      kill agent then wipe ~/.ide-ux-agentik (fresh DB)"

# ─── Frontend ────────────────────────────────────────────────────────────
install:
	bun install

dev:
	bun run dev

build:
	bun run build

preview:
	bun run preview

# ─── Agent ───────────────────────────────────────────────────────────────
agent-token:
	@openssl rand -hex 24

agent:
ifndef AGENT_TOKEN
	$(error AGENT_TOKEN is required — run `make agent-token` then `make agent AGENT_TOKEN=<value>`)
endif
	bun run agent/server.ts \
		--root  "$(AGENT_ROOT)" \
		--port  $(AGENT_PORT) \
		--host  $(AGENT_HOST) \
		--token "$(AGENT_TOKEN)"

# Convenience: dev agent rooted on repo with a generated token (prints it on start)
agent-dev:
	@TOKEN=$$(openssl rand -hex 24); \
		echo "[agent] token: $$TOKEN"; \
		echo "[agent] connect the webapp to ws://localhost:$(AGENT_PORT) with this token"; \
		bun run agent/server.ts \
			--root  "$(AGENT_ROOT)" \
			--port  $(AGENT_PORT) \
			--host  127.0.0.1 \
			--token "$$TOKEN"

# ─── Clean ───────────────────────────────────────────────────────────────
clean:
	rm -rf dist .vite node_modules/.vite

# ─── DB ──────────────────────────────────────────────────────────────────
db-path:
	@echo "$(DB_FILE)"

# Wipe the agent's SQLite store so the next boot rebuilds the schema from
# scratch (DDL in agent/persistence/schema.ts). Also kills any stale agent
# holding the WAL file open. The webapp will redo the setup wizard on
# next visit (its localStorage is independent — clear it from devtools or
# via the wizard's reset button if desired).
db-reset:
	@PID=$$(lsof -t -i :$(AGENT_PORT) -sTCP:LISTEN 2>/dev/null); \
		if [ -n "$$PID" ]; then \
			echo "[db-reset] killing stale agent (pid=$$PID)..."; \
			kill $$PID 2>/dev/null || true; \
			sleep 1; \
		fi; \
		echo "[db-reset] removing $(DB_FILE) (+ -wal/-shm + blobs/)"; \
		rm -f "$(DB_FILE)" "$(DB_FILE)-wal" "$(DB_FILE)-shm"; \
		rm -rf "$(DB_DIR)/blobs"; \
		echo "[db-reset] done. Restart with 'make agent-dev' or 'bun run dev'."

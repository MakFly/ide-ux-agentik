.PHONY: help dev build preview agent agent-dev agent-token install clean

# ─── Config ──────────────────────────────────────────────────────────────
AGENT_ROOT  ?= $(CURDIR)
AGENT_PORT  ?= 7421
AGENT_HOST  ?= 0.0.0.0
AGENT_TOKEN ?=

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

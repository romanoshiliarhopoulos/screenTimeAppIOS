# ── Config ────────────────────────────────────────────────────────────────────
# Override these on the command line:  make deploy SERVER=user@1.2.3.4
SERVER   ?= black
REMOTE   := ~/screenTimeAppIOS
SESSION  := expo

# ── Targets ───────────────────────────────────────────────────────────────────

.PHONY: deploy sync restart kill logs

## Full deploy: sync files → restart expo on server
deploy: sync restart

## Rsync frontend to server (excludes node_modules, .git, dist)
sync:
	@echo "→ Syncing files to $(SERVER):$(REMOTE)..."
	rsync -avz --progress \
		--exclude 'node_modules' \
		--exclude '.git' \
		--exclude 'dist' \
		--exclude '.expo' \
		frontend/ $(SERVER):$(REMOTE)/frontend/

## Kill old tmux session and start a fresh expo tunnel
restart:
	@echo "→ Restarting expo on server..."
	ssh $(SERVER) ' \
		tmux kill-session -t $(SESSION) 2>/dev/null || true; \
		cd $(REMOTE)/frontend && \
		npm install --silent && \
		tmux new-session -d -s $(SESSION) "npx expo start --tunnel --go"; \
		sleep 4 && \
		tmux capture-pane -pt $(SESSION) -S -50 \
	'

## Kill the expo tmux session on the server
kill:
	@echo "→ Killing expo session on $(SERVER)..."
	ssh $(SERVER) 'tmux kill-session -t $(SESSION) 2>/dev/null && echo "Session killed." || echo "No session running."'

## Tail the expo output from the server
logs:
	@echo "→ Attaching to expo logs on $(SERVER)..."
	ssh $(SERVER) 'tmux capture-pane -pt $(SESSION) -S -200; \
		tmux attach-session -t $(SESSION)'

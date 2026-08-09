.DEFAULT_GOAL := help

.PHONY: help install dev test test-api test-web typecheck lint format build eval e2e e2e-live seed reset-db docker-build up down logs ai-check clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "Targets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm workspace dependencies
	npm ci

dev: ## Run API and web dev servers
	npm run dev

test: ## Run API and web unit/integration tests
	npm test

test-api: ## Run API tests only
	npm run test:api

test-web: ## Run web tests only
	npm run test:web

typecheck: ## Typecheck all workspaces
	npm run typecheck

lint: ## Run ESLint
	npm run lint

format: ## Format the repository with Prettier
	npm run format

build: ## Build shared, API, and web packages
	npm run build

eval: ## Run deterministic AI eval harness
	npm run eval

e2e: ## Run deterministic Playwright suite
	npm run e2e

e2e-live: ## Run Playwright tests tagged for real Ollama
	E2E_LIVE_AI=1 npm run e2e -- --grep @live

seed: ## Seed the configured database if it is empty
	npm run seed

reset-db: ## Destructively reset and reseed the configured database
	npm run seed -- --force

docker-build: ## Build API and web container images
	docker compose build

up: ## Start the production compose stack at http://localhost:8080
	docker compose up --build

down: ## Stop the compose stack
	docker compose down

logs: ## Follow compose logs
	docker compose logs -f

ai-check: ## Query local API health and print AI availability
	curl -s http://localhost:3001/api/health | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const h=JSON.parse(s);console.log(h.ai.reachable ? 'AI reachable: '+h.ai.provider+' '+h.ai.model : 'AI unavailable: '+h.ai.detail);})"

clean: ## Remove generated build/test artifacts
	rm -rf apps/api/dist apps/web/dist packages/shared/dist coverage e2e/test-results e2e/playwright-report docs/screenshots

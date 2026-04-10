#!/usr/bin/env bash
# Observe 런타임 (단일 포트 — 서버가 빌드된 클라이언트 정적 파일을 함께 서빙)
# 사용법:
#   ./run-observe.sh            # 빌드 + 시작 (기본)
#   ./run-observe.sh start      # 빌드 생략 (dist 있으면 그대로)
#   ./run-observe.sh rebuild    # 강제 빌드 후 시작
#   ./run-observe.sh stop
#   ./run-observe.sh restart
#   ./run-observe.sh status
#   ./run-observe.sh logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
SERVER_DIR="$ROOT/app/server"
CLIENT_DIR="$ROOT/app/client"
CLIENT_DIST="$CLIENT_DIR/dist"
LOG_DIR="$ROOT/.run-logs"
LOG="$LOG_DIR/observe.log"
PIDFILE="$LOG_DIR/observe.pid"
PORT=4981

mkdir -p "$LOG_DIR"

kill_port() {
  local pids
  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "  → killing existing :$PORT ($pids)"
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

build_client() {
  echo "▶ client 빌드 (vite build)"
  (cd "$CLIENT_DIR" && npx vite build)
}

start() {
  local do_build="${1:-auto}"
  if [[ "$do_build" == "force" ]] || [[ "$do_build" == "auto" && ! -f "$CLIENT_DIST/index.html" ]]; then
    build_client
  fi
  echo "▶ Observe 시작 (단일 포트 :$PORT)"
  kill_port
  echo "  → server (tsx) — log: $LOG"
  (
    cd "$SERVER_DIR"
    AGENTS_OBSERVE_SERVER_PORT="$PORT" \
    AGENTS_OBSERVE_CLIENT_DIST_PATH="$CLIENT_DIST" \
      nohup npx tsx src/index.ts > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
  )
  sleep 2
  status
  echo
  echo "✅ 접속: http://localhost:$PORT"
}

stop() {
  echo "■ Observe 종료"
  kill_port
  rm -f "$PIDFILE"
  echo "  done"
}

status() {
  printf "  observe :%s → " "$PORT"
  lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && echo "UP" || echo "DOWN"
}

logs() { tail -n 80 -F "$LOG"; }

case "${1:-start}" in
  start)   start auto ;;
  rebuild) start force ;;
  stop)    stop ;;
  restart) stop; start auto ;;
  status)  status ;;
  logs)    logs ;;
  *) echo "usage: $0 {start|rebuild|stop|restart|status|logs}"; exit 1 ;;
esac

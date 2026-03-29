#!/bin/bash

# Ensure Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "\033[31mError: Docker is not running or not installed. Please start Docker first.\033[0m"
  exit 1
fi

echo "Starting Redis via Docker..."
docker compose up -d

echo "Starting Backend Server..."
(cd backend && node index.js) &
BACKEND_PID=$!

echo "Starting Worker Engine..."
(cd worker && node index.js) &
WORKER_PID=$!

echo "Starting Frontend Development Server..."
(cd frontend && npm run dev -- --host) &
FRONTEND_PID=$!

# Trap Ctrl+C (SIGINT) to clean up background processes
trap "echo 'Shutting down services...'; kill $BACKEND_PID $WORKER_PID $FRONTEND_PID; docker compose down; exit" SIGINT SIGTERM

echo ""
echo -e "\033[32mAll services started successfully!\033[0m"
echo -e "Frontend is at: \033[34mhttp://localhost:5173\033[0m"
echo -e "Backend is at: \033[34mhttp://localhost:3001\033[0m"
echo "Press Ctrl+C to stop all services."
echo ""

wait

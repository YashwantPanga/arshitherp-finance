@echo off
rem Starts the local PostgreSQL cluster (port 5434) and the ERP in production mode on http://localhost:3100
cd /d "%~dp0"
pg_ctl -D "%~dp0.pgdata" -o "-p 5434" -l "%~dp0.pgdata\server.log" start
if not exist ".next" call npm run build
call npm run start -- -p 3100

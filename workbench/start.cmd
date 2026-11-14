@echo off
chcp 65001 >nul
title Memory Workbench
if defined DSMP_NODE goto run
set "DSMP_NODE=node"
:run
"%DSMP_NODE%" "%~dp0server.mjs" --port 7351

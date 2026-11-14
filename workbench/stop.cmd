@echo off
chcp 65001 >nul
title Stop Memory Workbench
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
ping -n 2 127.0.0.1 >nul

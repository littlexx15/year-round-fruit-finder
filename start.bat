@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动全年水果雷达...
echo.
echo 请保持这个窗口开启。关闭窗口后，网页将无法扫描或读取数据。
echo 浏览器将在服务启动后自动打开...
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3789'"
node server.js
pause

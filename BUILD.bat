@echo off
echo Building Chat App Logger...
g++ -std=c++17 src/main.cpp src/chat_logger.cpp src/http_server.cpp -o chat_logger_web_clean.exe -lws2_32
if %ERRORLEVEL% EQU 0 (
  echo Build successful!
  echo Run the application with START_WEB.bat
) else (
  echo Build failed!
)
pause

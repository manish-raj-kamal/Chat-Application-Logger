@echo off
echo.
echo =================================
echo   CHAT APP LOGGER - WEB VERSION
echo   Queue Data Structure (FIFO)
echo =================================
echo.

:: Go to the directory where this file is located
cd /d "%~dp0"

:: Create logs directory if needed
if not exist logs mkdir logs

:: Check if web version exists
if exist chat_logger_web_clean.exe (
    echo Starting Web Chat Logger...
    echo Open browser to: http://localhost:8080
    echo Press Ctrl+C to stop server
    echo.
    start http://localhost:8080
    chat_logger_web_clean.exe
) else if exist chat_logger_web.exe (
    echo Starting Web Chat Logger...
    echo Open browser to: http://localhost:8080
    echo Press Ctrl+C to stop server
    echo.
    start http://localhost:8080
    chat_logger_web.exe
) else (
    echo Web version not found. Building...
    g++ -std=c++17 -pthread -o chat_logger_web_clean.exe src\main.cpp src\chat_logger.cpp src\http_server.cpp -lws2_32
    if exist chat_logger_web_clean.exe (
        echo Build successful! Starting web server...
        echo Open browser to: http://localhost:8080
        start http://localhost:8080
        chat_logger_web_clean.exe
    ) else (
        echo Web build failed. Trying console version...
        if exist chat_logger_console_clean.exe (
            chat_logger_console_clean.exe
        ) else if exist chat_logger_console.exe (
            chat_logger_console.exe
        ) else (
            echo No versions available. Install MinGW/GCC compiler.
        )
    )
)

echo.
echo Press any key to exit...
pause > nul

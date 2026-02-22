@echo off
echo ===============================================
echo   ChatApp Logger - C++ Build (Local Mode)
echo   In-memory storage, Simple auth (no Google)
echo ===============================================
echo.

:: Check for g++ compiler
where g++ >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: g++ not found. Install MinGW-w64 and add to PATH.
    echo Download: https://www.mingw-w64.org/
    pause
    exit /b 1
)

:: Check for header files
if not exist "include\httplib.h" (
    echo ERROR: include\httplib.h not found!
    echo Run: powershell -c "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.18.3/httplib.h' -OutFile 'include\httplib.h'"
    pause
    exit /b 1
)
if not exist "include\json.hpp" (
    echo ERROR: include\json.hpp not found!
    echo Run: powershell -c "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp' -OutFile 'include\json.hpp'"
    pause
    exit /b 1
)

echo [1/2] Compiling C++ server (local mode)...
g++ -std=c++17 -O2 -o server.exe cpp/server.cpp -Iinclude -Icpp -lws2_32

if %ERRORLEVEL% neq 0 (
    echo.
    echo BUILD FAILED!
    pause
    exit /b 1
)

echo [2/2] Build successful!
echo.
echo ===============================================
echo   Run with:  server.exe
echo   Open:      http://localhost:8080
echo ===============================================
echo.
pause

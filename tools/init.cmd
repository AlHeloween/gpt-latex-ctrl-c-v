@echo off
REM Initialize development environment for GPT LATEX Ctrl-C Ctrl-V extension
REM This script sets up Python dependencies, Playwright browsers, and verifies tools

setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..

echo ========================================
echo GPT LATEX Ctrl-C Ctrl-V
echo Development Environment Initialization
echo ========================================
echo.

REM Check if uv is installed
echo [1/5] Checking uv (Python package manager)...
where uv >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] uv is not installed or not in PATH.
    echo.
    echo Please install uv first:
    echo   PowerShell: irm https://astral.sh/uv/install.ps1 ^| iex
    echo   Or visit: https://github.com/astral-sh/uv
    echo.
    exit /b 1
)
echo [OK] uv found
uv --version
echo.

REM Check Python version
echo [2/5] Checking Python version...
uv run python --version
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python check failed.
    exit /b 1
)
echo [OK] Python is available
echo.

REM Sync dependencies
echo [3/5] Installing Python dependencies (uv sync)...
cd /d "%PROJECT_ROOT%"
uv sync
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to sync dependencies.
    exit /b 1
)
echo [OK] Dependencies installed
echo.

REM Install Playwright browsers
echo [4/5] Installing Playwright browsers (chromium)...
uv run playwright install chromium
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Playwright browser installation failed or skipped.
    echo           This is OK if browsers are already installed.
) else (
    echo [OK] Playwright browsers installed
)
echo.

REM Check Rust (optional, for WASM builds)
echo [5/5] Checking Rust (for WASM builds)...
where rustc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    rustc --version
    echo [OK] Rust is available (WASM builds can be performed)
) else (
    echo [INFO] Rust not found. WASM builds will require Rust installation.
    echo        Install from: https://www.rust-lang.org/tools/install
)
echo.

REM Verify build tools
echo ========================================
echo Verifying build tools...
echo ========================================
echo.

echo Checking build scripts...
if exist "%PROJECT_ROOT%\tools\build_rust_wasm.py" (
    echo [OK] build_rust_wasm.py found
) else (
    echo [WARNING] build_rust_wasm.py not found
)

if exist "%PROJECT_ROOT%\tools\build_firefox_xpi.py" (
    echo [OK] build_firefox_xpi.py found
) else (
    echo [WARNING] build_firefox_xpi.py not found
)

if exist "%PROJECT_ROOT%\tools\build_chromium_extension.py" (
    echo [OK] build_chromium_extension.py found
) else (
    echo [WARNING] build_chromium_extension.py not found
)
echo.

REM Optional: Build WASM if Rust is available
where rustc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ========================================
    echo Building WASM module (optional)...
    echo ========================================
    echo.
    echo Building Rust WASM module...
    uv run python "%PROJECT_ROOT%\tools\build_rust_wasm.py"
    if %ERRORLEVEL% EQU 0 (
        echo [OK] WASM module built successfully
    ) else (
        echo [WARNING] WASM build failed. This is OK if you don't need WASM yet.
    )
    echo.
)

echo ========================================
echo Initialization Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Run tests:     tests\run_tests.bat
echo   2. Build Firefox: uv run python tools\build_firefox_xpi.py --out dist\gpt-latex-ctrl-c-v.xpi
echo   3. Build Chromium: uv run python tools\build_chromium_extension.py
echo.
echo For more information, see README.md
echo.

endlocal


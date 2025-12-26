@echo off
REM Run comprehensive test suite for Copy as Office Format extension

echo ============================================================
echo Comprehensive Extension Test Suite
echo ============================================================
echo.

setlocal
pushd "%~dp0"

REM Check if uv is available
uv --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: uv is not installed or not in PATH
    exit /b 1
)

REM Run comprehensive tests
echo Running comprehensive tests...
echo.

uv run python test_comprehensive.py %*

if errorlevel 1 (
    echo.
    echo ============================================================
    echo Tests completed with failures
    echo ============================================================
    popd
    exit /b 1
) else (
    echo.
    echo ============================================================
    echo All tests passed!
    echo ============================================================
    popd
    exit /b 0
)


@echo off
REM Run comprehensive test suite for Copy as Office Format extension

echo ============================================================
echo Comprehensive Extension Test Suite
echo ============================================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    exit /b 1
)

REM Run comprehensive tests
echo Running comprehensive tests...
echo.

python tests\test_comprehensive.py %*

if errorlevel 1 (
    echo.
    echo ============================================================
    echo Tests completed with failures
    echo ============================================================
    exit /b 1
) else (
    echo.
    echo ============================================================
    echo All tests passed!
    echo ============================================================
    exit /b 0
)


@echo off
REM Run fully automated tests for the extension on Windows
REM Using uv package manager

echo Checking uv environment...
python --version

echo.
echo Running FULLY AUTOMATED test suite...
echo (No manual steps required)
echo.
echo Usage: run_tests.bat [--headless] [--debug]
echo.

python test_automated.py %*

if %ERRORLEVEL% EQU 0 (
    echo.
    echo All tests passed!
) else (
    echo.
    echo Some tests failed. Check output above.
)

pause


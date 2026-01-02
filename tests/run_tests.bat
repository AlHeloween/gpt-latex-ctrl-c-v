@echo off
REM Run fully automated tests for the extension on Windows
REM Using uv package manager

setlocal
pushd "%~dp0"

echo Running unified test runner...
echo.
echo Usage:
echo   run_tests.bat [--fast] [--include-large] [--headless] [--debug] [--browser chromium^|firefox]
echo.
echo Note: Without --fast, Windows runs real clipboard tests and overwrites your clipboard.
echo.

uv run python run_all.py %*
set TESTS_ERRORLEVEL=%ERRORLEVEL%

popd
pause

if %TESTS_ERRORLEVEL% NEQ 0 exit /b %TESTS_ERRORLEVEL%

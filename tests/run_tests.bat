@echo off
REM Run fully automated tests for the extension on Windows
REM Using uv package manager

setlocal
pushd "%~dp0"

echo Checking uv environment...
uv --version
uv run python --version

echo.
echo Building Rust WASM (tex_to_mathml.wasm)...
uv run python ..\lib\tools\build_rust_wasm.py
if %ERRORLEVEL% NEQ 0 (
    echo ? Rust WASM build failed.
    popd
    exit /b 1
)

echo.
echo Checking JS size budgets...
uv run python ..\lib\tools\check_js_size.py
if %ERRORLEVEL% NEQ 0 (
    echo ? JS size budget failed.
    popd
    exit /b 1
)

echo.
echo Running FULLY AUTOMATED test suite...
echo (No manual steps required)
echo.
echo Usage: run_tests.bat [--headless] [--debug]
echo.

uv run python test_automated.py %*
set TESTS_ERRORLEVEL=%ERRORLEVEL%

echo.
echo Running Word example verification (skips if Word is not available)...
uv run python test_word_examples.py
set WORD_ERRORLEVEL=%ERRORLEVEL%

echo.
echo Generating docx outputs from examples to test_results\docx...
uv run python test_generate_docx_examples.py --include-large
set DOCX_ERRORLEVEL=%ERRORLEVEL%

echo.
echo Running real clipboard -^> docx verification (Windows-only; writes test_results\real_clipboard)...
uv run python test_real_clipboard_docx.py --include-large
set REAL_CLIP_ERRORLEVEL=%ERRORLEVEL%

echo.
echo Running real clipboard -^> markdown verification (Windows-only; writes test_results\real_clipboard_markdown)...
uv run python test_real_clipboard_markdown.py
set REAL_MD_ERRORLEVEL=%ERRORLEVEL%

echo.
echo Cleaning test_results to keep only the most recent outputs...
uv run python ..\lib\tools\cleanup_test_results.py

if %TESTS_ERRORLEVEL% EQU 0 (
    echo.
    echo All tests passed!
) else (
    echo.
    echo Some tests failed. Check output above.
)

popd
pause

if %TESTS_ERRORLEVEL% NEQ 0 exit /b %TESTS_ERRORLEVEL%
if %WORD_ERRORLEVEL% NEQ 0 exit /b %WORD_ERRORLEVEL%
if %DOCX_ERRORLEVEL% NEQ 0 exit /b %DOCX_ERRORLEVEL%
if %REAL_CLIP_ERRORLEVEL% NEQ 0 exit /b %REAL_CLIP_ERRORLEVEL%
if %REAL_MD_ERRORLEVEL% NEQ 0 exit /b %REAL_MD_ERRORLEVEL%

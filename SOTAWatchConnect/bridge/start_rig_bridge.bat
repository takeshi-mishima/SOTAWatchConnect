@echo off
:: Change current directory to the location of this batch file
cd /d "%~dp0"

:: Status message
echo Starting SOTAWatch Connect bridge...

:: Use pythonw.exe to run without a console window (requires Python in your PATH)
:: You can use 'python rig_bridge.py' if you prefer to see the console
where pythonw >nul 2>&1
if errorlevel 1 (
    echo ERROR: pythonw.exe not found. Please install Python from python.org.
    pause
    exit /b 1
)
start /b pythonw rig_bridge.py
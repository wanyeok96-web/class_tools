@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ========================================
echo   Class Tools 문서변환기 준비 중...
echo  ========================================
echo.

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if %ERRORLEVEL%==0 (
    set "PY=python"
  ) else (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo https://www.python.org/downloads/ 에서 Python 3을 설치한 뒤
    echo 다시 실행해주세요. ^(설치 시 Add to PATH 체크^)
    echo.
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo 가상환경을 만드는 중...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo [오류] 가상환경 생성에 실패했습니다.
    pause
    exit /b 1
  )
)

echo 패키지 확인 중...
".venv\Scripts\python.exe" -c "import win32com.client" >nul 2>&1
if errorlevel 1 (
  echo pywin32 설치 중...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
  )
)

echo.
echo 변환기를 시작합니다. 이 창은 그대로 두세요.
echo 클래스툴 → 문서변환 에서 파일을 올리면 됩니다.
echo.
".venv\Scripts\python.exe" server.py
echo.
pause

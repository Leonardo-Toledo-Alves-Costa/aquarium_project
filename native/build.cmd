@echo off
rem Compila native\audio\aquarium-audio.cpp em native\bin\aquarium-audio.exe.
rem Precisa do Visual Studio com "Desenvolvimento para desktop com C++" e o Windows 11 SDK.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%i"
if not defined VSINSTALL (
  echo Visual Studio com C++ nao encontrado.
  exit /b 1
)
set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
call "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist bin mkdir bin
if not exist obj mkdir obj
rem /MT: runtime embutido, para rodar em PCs sem o pacote do Visual C++.
cl /nologo /EHsc /std:c++20 /O2 /W4 /MT /utf-8 /DUNICODE /D_UNICODE /Foobj\ audio\aquarium-audio.cpp /Fe:bin\aquarium-audio.exe ole32.lib mmdevapi.lib winmm.lib user32.lib || exit /b 1
echo Gerado: %~dp0bin\aquarium-audio.exe

@echo off
setlocal
cd /d "%~dp0"
set "OMNI_PROJECT=%USERPROFILE%\OmniMemory-Desktop"
if not "%~1"=="" set "OMNI_PROJECT=%~1"
echo Feche o OmniMemory pelo icone ao lado do relogio e encerre o tunel de teste com Ctrl+C.
echo Este processo aplica a versao 1.3.5, executa os testes e gera o instalador.
echo Projeto: %OMNI_PROJECT%
echo Suas memorias nao fazem parte da atualizacao.
pause
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Abra o terminal onde voce utiliza o projeto.
  pause
  exit /b 1
)
node "%~dp0aplicar-atualizacao.mjs" "%OMNI_PROJECT%" --build
set "OMNI_UPDATE_RESULT=%ERRORLEVEL%"
if not "%OMNI_UPDATE_RESULT%"=="0" (
  echo.
  echo Processo interrompido. Confira a mensagem acima e nao instale um arquivo antigo.
) else (
  echo.
  echo Processo concluido. Confira a data do novo instalador.
  if exist "%OMNI_PROJECT%\dist" start "" explorer.exe "%OMNI_PROJECT%\dist"
)
pause
exit /b %OMNI_UPDATE_RESULT%

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set /p msg=Введите название коммита: 

if "%msg%"=="" (
    echo Вы не ввели название коммита.
    pause
    exit /b
)

git add .
git commit -m "!msg!"
git push

pause

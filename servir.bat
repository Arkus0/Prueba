@echo off
rem Sirve la app en este PC: abre http://localhost:8000 en el navegador.
rem (Opcional para otros dispositivos en la WiFi: python servir.py --https)
cd /d "%~dp0"
start "" http://localhost:8000
python servir.py --port 8000
pause

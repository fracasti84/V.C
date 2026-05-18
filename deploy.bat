@echo off
echo.
echo  MoneyMeKa Pro -- Deploy to GitHub
echo  -----------------------------------
git add .
git commit -m "Update site"
git push origin main
echo.
echo  Done! Site will update on moneymekapro.com in ~60 seconds.
echo.
pause
